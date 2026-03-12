import { Shield } from 'lucide-react'

interface AgreementModalProps {
  agreementChecked: boolean
  onAgreementCheckedChange: (checked: boolean) => void
  onAgree: () => void | Promise<void>
  onDisagree: () => void
}

function AgreementModal({
  agreementChecked,
  onAgreementCheckedChange,
  onAgree,
  onDisagree
}: AgreementModalProps) {
  return (
    <div className="agreement-overlay">
      <div className="agreement-modal">
        <div className="agreement-header">
          <Shield size={32} />
          <h2>用户协议与隐私政策</h2>
        </div>
        <div className="agreement-content">
          <p>欢迎使用 Chat Capsule！在使用本软件前，请仔细阅读以下条款：</p>
          <div className="agreement-notice">
            <strong>这是免费软件，如果你是付费购买的话请骂死那个骗子。</strong>
          </div>
          <div className="agreement-text">
            <h4>0. 项目来源</h4>
            <p>本项目以新名字独立发布，属于基于 WeFlow 演进的非官方维护分支；请以当前仓库页面、许可证与 Fork 说明为准理解其来源与分发边界。</p>

            <h4>1. 数据安全</h4>
            <p>本软件所有数据处理均在本地完成，不会上传任何聊天记录、个人信息到服务器。你的数据完全由你自己掌控。</p>

            <h4>2. 使用须知</h4>
            <p>本软件仅供个人学习研究使用，请勿用于任何非法用途。使用本软件解密、查看、分析的数据应为你本人所有或已获得授权。</p>

            <h4>3. 免责声明</h4>
            <p>因使用本软件产生的任何直接或间接损失，开发者不承担任何责任。请确保你的使用行为符合当地法律法规。</p>

            <h4>4. 隐私保护</h4>
            <p>本软件不收集任何用户数据。本软件不包含联网更新检测。</p>
          </div>
        </div>
        <div className="agreement-footer">
          <label className="agreement-checkbox">
            <input
              type="checkbox"
              checked={agreementChecked}
              onChange={(e) => onAgreementCheckedChange(e.target.checked)}
            />
            <span>我已阅读并同意上述协议</span>
          </label>
          <div className="agreement-actions">
            <button className="btn btn-secondary" onClick={onDisagree}>不同意</button>
            <button className="btn btn-primary" onClick={onAgree} disabled={!agreementChecked}>同意并继续</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AgreementModal
