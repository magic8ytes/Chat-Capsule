import { useState, useEffect, useRef } from 'react'
import { ArrowRight, Fingerprint, Lock, ScanFace, ShieldCheck } from 'lucide-react'
import { auth } from '../services/ipc'
import { createLogger } from '../utils/logger'
import { AvatarImage } from './AvatarImage'
import './LockScreen.scss'

const logger = createLogger('LockScreen')

interface LockScreenProps {
    onUnlock: () => void
    avatar?: string
    useHello?: boolean
}

export default function LockScreen({ onUnlock, avatar, useHello = false }: LockScreenProps) {
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [isVerifying, setIsVerifying] = useState(false)
    const [isUnlocked, setIsUnlocked] = useState(false)
    const [showHello, setShowHello] = useState(false)
    const [helloAvailable, setHelloAvailable] = useState(false)

    // 用于取消 WebAuthn 请求
    const abortControllerRef = useRef<AbortController | null>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        // 快速检查配置并启动
        quickStartHello()
        inputRef.current?.focus()

        return () => {
            // 组件卸载时取消请求
            abortControllerRef.current?.abort()
        }
    }, [])

    const handleUnlock = () => {
        setIsUnlocked(true)
        setTimeout(() => {
            onUnlock()
        }, 1500)
    }

    const quickStartHello = async () => {
        try {
            if (useHello) {
                setHelloAvailable(true)
                setShowHello(true)
                verifyHello()
            }
        } catch (e) {
            logger.error('Quick start hello failed', e)
        }
    }

    const verifyHello = async () => {
        if (isVerifying || isUnlocked) return

        setIsVerifying(true)
        setError('')

        try {
            const result = await auth.hello()

            if (result.success) {
                handleUnlock()
            } else {
                logger.error('Hello verification failed:', result.error)
                setError(result.error || '验证失败')
            }
        } catch (error: unknown) {
            logger.error('Hello verification error:', error)
            setError(`验证失败: ${error instanceof Error ? error.message : String(error)}`)
        } finally {
            setIsVerifying(false)
        }
    }

    const handlePasswordSubmit = async (e?: React.FormEvent) => {
        e?.preventDefault()
        if (!password || isUnlocked) return

        setIsVerifying(true)
        setError('')

        try {
            // 发送原始密码到主进程，由主进程验证并解密密钥
            const result = await auth.unlock(password)

            if (result.success) {
                handleUnlock()
            } else {
                setError(result.error || '密码错误')
                setPassword('')
                setIsVerifying(false)
            }
        } catch (e) {
            setError('验证失败')
            setIsVerifying(false)
        }
    }

    return (
        <div className={`lock-screen ${isUnlocked ? 'unlocked' : ''}`}>
            <div className="lock-content">
                <div className="lock-avatar">
                    {avatar ? (
                        <AvatarImage src={avatar} alt="User" loading="eager" />
                    ) : (
                        <Lock size={40} />
                    )}
                </div>

                <h2 className="lock-title">Chat Capsule 已锁定</h2>

                <form className="lock-form" onSubmit={handlePasswordSubmit}>
                    <div className="input-group">
                        <input
                            ref={inputRef}
                            type="password"
                            placeholder="输入应用密码"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        // 移除 disabled，允许用户随时输入
                        />
                        <button type="submit" className="submit-btn" disabled={!password}>
                            <ArrowRight size={18} />
                        </button>
                    </div>

                    {showHello && (
                        <button
                            type="button"
                            className={`hello-btn ${isVerifying ? 'loading' : ''}`}
                            onClick={verifyHello}
                        >
                            <Fingerprint size={20} />
                            {isVerifying ? '验证中...' : '使用系统生物识别解锁'}
                        </button>
                    )}
                </form>

                {error && <div className="lock-error">{error}</div>}
            </div>
        </div>
    )
}
