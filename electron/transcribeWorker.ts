import { parentPort, workerData } from 'worker_threads'
import path from 'path'

interface WorkerParams {
    modelPath: string
    tokensPath: string
    wavData: Buffer
    sampleRate: number
    languages?: string[]
}

function readWavSampleRate(wav: Buffer, fallback: number): number {
    if (!wav || wav.length < 28) return fallback
    try {
        return wav.readUInt32LE(24)
    } catch {
        return fallback
    }
}

function resampleLinear(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
    if (fromRate === toRate) return samples
    if (fromRate <= 0 || toRate <= 0 || samples.length === 0) return samples

    const ratio = toRate / fromRate
    const newLength = Math.max(1, Math.floor(samples.length * ratio))
    const out = new Float32Array(newLength)

    for (let i = 0; i < newLength; i++) {
        const srcIndex = i / ratio
        const left = Math.floor(srcIndex)
        const right = Math.min(left + 1, samples.length - 1)
        const frac = srcIndex - left
        out[i] = samples[left] * (1 - frac) + samples[right] * frac
    }

    return out
}

// 语言标记映射
const LANGUAGE_TAGS: Record<string, string> = {
    'zh': '<|zh|>',
    'en': '<|en|>',
    'ja': '<|ja|>',
    'ko': '<|ko|>',
    'yue': '<|yue|>' // 粤语
}

// 技术标签（识别语言、语速、ITN等），需要从最终文本中移除
const TECH_TAGS = [
    '<|zh|>', '<|en|>', '<|ja|>', '<|ko|>', '<|yue|>',
    '<|nospeech|>', '<|speech|>',
    '<|itn|>', '<|wo_itn|>',
    '<|NORMAL|>'
]

// 情感与事件标签映射，转换为直观的 Emoji
const RICH_TAG_MAP: Record<string, string> = {
    '<|HAPPY|>': '😊',
    '<|SAD|>': '😔',
    '<|ANGRY|>': '😠',
    '<|NEUTRAL|>': '', // 中性情感不特别标记
    '<|FEARFUL|>': '😨',
    '<|DISGUSTED|>': '🤢',
    '<|SURPRISED|>': '😮',
    '<|BGM|>': '🎵',
    '<|Applause|>': '👏',
    '<|Laughter|>': '😂',
    '<|Cry|>': '😭',
    '<|Cough|>': ' (咳嗽) ',
    '<|Sneeze|>': ' (喷嚏) ',
}

/**
 * 富文本后处理：移除技术标签，转换识别出的情感和声音事件
 */
function richTranscribePostProcess(text: string): string {
    if (!text) return ''

    let processed = text

    // 1. 转换情感和事件标签
    for (const [tag, replacement] of Object.entries(RICH_TAG_MAP)) {
        // 使用正则全局替换，不区分大小写以防不同版本差异
        const escapedTag = tag.replace(/[|<>]/g, '\\$&')
        processed = processed.replace(new RegExp(escapedTag, 'gi'), replacement)
    }

    // 2. 移除所有剩余的技术标签
    for (const tag of TECH_TAGS) {
        const escapedTag = tag.replace(/[|<>]/g, '\\$&')
        processed = processed.replace(new RegExp(escapedTag, 'gi'), '')
    }

    // 3. 清理多余空格并返回
    return processed.replace(/\s+/g, ' ').trim()
}

// 检查识别结果是否在允许的语言列表中
function isLanguageAllowed(result: any, allowedLanguages: string[]): boolean {
    if (!result || !result.lang) {
        // 如果没有语言信息，默认允许（或从文本开头尝试提取）
        return true
    }

    // 如果没有指定语言或语言列表为空，默认允许中文和粤语
    if (!allowedLanguages || allowedLanguages.length === 0) {
        allowedLanguages = ['zh', 'yue']
    }

    const langTag = result.lang
    

    // 检查是否在允许的语言列表中
    for (const lang of allowedLanguages) {
        if (LANGUAGE_TAGS[lang] === langTag) {
            
            return true
        }
    }

    
    return false
}

async function run() {
    if (!parentPort) {
        return;
    }

    try {
        // Ensure native dylibs are discoverable before loading the addon on macOS/Linux.
        try {
            if (process.platform === 'darwin' || process.platform === 'linux') {
                const isDarwin = process.platform === 'darwin'
                const envKey = isDarwin ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH'
                const packageName = `sherpa-onnx-${process.platform === 'darwin' ? 'darwin' : 'linux'}-${process.arch}`
                const resolved = require.resolve(packageName)
                const moduleDir = path.dirname(resolved)
                const current = process.env[envKey] || ''
                if (!current.includes(moduleDir)) {
                    process.env[envKey] = current ? `${moduleDir}:${current}` : moduleDir
                }
            }
        } catch {
            // Best effort only; will fail later with a clear error message if still not loadable.
        }

        // 动态加载以捕获可能的加载错误（如 C++ 运行库缺失等）
        let sherpa: any;
        try {
            sherpa = require('sherpa-onnx-node');
        } catch (requireError) {
            parentPort.postMessage({ type: 'error', error: 'Failed to load speech engine: ' + String(requireError) });
            return;
        }

        const { modelPath, tokensPath, wavData: rawWavData, sampleRate, languages } = workerData as WorkerParams
        const wavData = Buffer.from(rawWavData);
        const wavSampleRate = readWavSampleRate(wavData, sampleRate)
        // 确保有有效的语言列表，默认只允许中文
        let allowedLanguages = languages || ['zh']
        if (allowedLanguages.length === 0) {
            allowedLanguages = ['zh']
        }

        

        // 1. 初始化识别器 (SenseVoiceSmall)
        const recognizerConfig = {
            modelConfig: {
                senseVoice: {
                    model: modelPath,
                    useInverseTextNormalization: 1
                },
                tokens: tokensPath,
                numThreads: 2,
                debug: 0
            }
        }
        const recognizer = new sherpa.OfflineRecognizer(recognizerConfig)

        // 2. 处理音频数据 (全量识别)
        const pcmData = wavData.slice(44)
        const samples = new Float32Array(pcmData.length / 2)
        for (let i = 0; i < samples.length; i++) {
            samples[i] = pcmData.readInt16LE(i * 2) / 32768.0
        }

        const targetSampleRate = 16000
        const normalizedSamples = wavSampleRate === targetSampleRate
            ? samples
            : resampleLinear(samples, wavSampleRate, targetSampleRate)

        const stream = recognizer.createStream()
        stream.acceptWaveform({ sampleRate: targetSampleRate, samples: normalizedSamples })
        recognizer.decode(stream)
        const result = recognizer.getResult(stream)

        

        // 3. 检查语言是否在白名单中
        if (isLanguageAllowed(result, allowedLanguages)) {
            const processedText = richTranscribePostProcess(result.text)
            
            parentPort.postMessage({ type: 'final', text: processedText })
        } else {
            
            parentPort.postMessage({ type: 'final', text: '' })
        }

    } catch (error) {
        parentPort.postMessage({ type: 'error', error: String(error) })
    }
}

run();
