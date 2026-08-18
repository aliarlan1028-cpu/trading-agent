import { useEffect, useRef, useState } from "react";
import { KeyRound, Lock, ShieldCheck, Upload, UserRound } from "lucide-react";
import { t } from "./i18n.js";

function InlineStatus({ tone = "neutral", children }) {
  return <span className={`accountInlineStatus ${tone}`}>{children}</span>;
}

export function AccountSettingsConcept({ data, action, notify }) {
  const user = data.user || {};
  const [name, setName] = useState(user.name || "");
  const [avatar, setAvatar] = useState(user.avatar || "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mfaEnabled, setMfaEnabled] = useState(user.mfaEnabled === true);
  const [mfaEnrollment, setMfaEnrollment] = useState(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaPassword, setMfaPassword] = useState("");
  const fileRef = useRef(null);

  useEffect(() => {
    setName(user.name || "");
    setAvatar(user.avatar || "");
    setMfaEnabled(user.mfaEnabled === true);
  }, [user.name, user.avatar, user.mfaEnabled]);

  const profileDirty = name.trim() !== (user.name || "") || avatar !== (user.avatar || "");

  function pickAvatar(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      notify?.(t("请选择图片文件", "Please choose an image file"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const image = new globalThis.Image();
      image.onload = () => {
        const size = 128;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const scale = Math.max(size / image.width, size / image.height);
        const width = image.width * scale;
        const height = image.height * scale;
        const context = canvas.getContext("2d");
        context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
        setAvatar(canvas.toDataURL("image/jpeg", 0.85));
      };
      image.onerror = () => notify?.(t("图片无法读取", "Unable to read this image"));
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  async function saveProfile() {
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 40) {
      notify?.(t("名称需 1–40 个字符", "Name must be 1–40 characters"));
      return;
    }
    setSavingProfile(true);
    const result = await action("/api/account/profile", { name: trimmed, avatar }, "PATCH");
    setSavingProfile(false);
    if (result?.ok === true) notify?.(t("资料已更新", "Profile updated"));
  }

  async function changePassword() {
    if (newPassword.length < 10) {
      notify?.(t("新密码至少 10 位", "New password must be at least 10 characters"));
      return;
    }
    if (newPassword !== confirmPassword) {
      notify?.(t("两次输入的新密码不一致", "New passwords do not match"));
      return;
    }
    const result = await action("/api/auth/change-password", { oldPassword, newPassword });
    if (result?.ok === true) {
      notify?.(t("密码已修改", "Password updated"));
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    }
  }

  async function startMfaEnrollment() {
    if (!mfaPassword) {
      notify?.(t("请输入当前登录密码后再配置双因素认证", "Enter your current password before setting up 2FA"));
      return;
    }
    const result = await action("/api/account/mfa/enroll", { currentPassword: mfaPassword });
    if (result?.secret) {
      setMfaEnrollment(result);
      setMfaCode("");
    }
  }

  async function confirmMfa() {
    const result = await action("/api/account/mfa/confirm", { code: mfaCode, currentPassword: mfaPassword });
    if (result?.ok) {
      setMfaEnabled(true);
      setMfaEnrollment(null);
      setMfaCode("");
      setMfaPassword("");
      notify?.(t("双因素认证已启用，其他登录已退出", "Two-factor authentication enabled; other sessions were signed out"));
    }
  }

  async function disableMfa() {
    const result = await action("/api/account/mfa", { code: mfaCode, currentPassword: mfaPassword }, "DELETE");
    if (result?.ok) {
      setMfaEnabled(false);
      setMfaCode("");
      setMfaPassword("");
      notify?.(t("双因素认证已停用，其他登录已退出", "Two-factor authentication disabled; other sessions were signed out"));
    }
  }

  return <div className="accountSettingsStack">
    <section className="cp2Card accountSettingsCard">
      <header className="accountSettingsHead"><span><UserRound/></span><div><b>{t("个人资料", "Profile")}</b><small>{t("显示名称和头像的唯一修改入口", "The only place to edit your display name and avatar")}</small></div><InlineStatus tone="good">{t("已登录", "Signed in")}</InlineStatus></header>
      <div className="accountProfileBody">
        <div className="accountAvatarEditor"><div>{avatar ? <img src={avatar} alt=""/> : (name || "A").slice(0, 1).toUpperCase()}</div><span><b>{name || user.email || t("账户", "Account")}</b><small>{user.email || "—"}</small><button type="button" className="cp2Secondary" onClick={() => fileRef.current?.click()}><Upload/>{t("上传头像", "Upload avatar")}</button>{avatar && <button type="button" className="cp2Link" onClick={() => setAvatar("")}>{t("移除", "Remove")}</button>}<input ref={fileRef} hidden type="file" accept="image/*" onChange={pickAvatar}/></span></div>
        <label className="accountSettingsField"><span><b>{t("显示名称", "Display name")}</b><small>{t("用于审批、复盘和审计记录", "Used in approvals, reviews, and audit records")}</small></span><input maxLength={40} value={name} onChange={(event) => setName(event.target.value)}/></label>
        <label className="accountSettingsField"><span><b>{t("登录邮箱", "Sign-in email")}</b><small>{t("身份标识由服务端管理", "Identity is managed by the server")}</small></span><input readOnly value={user.email || ""}/></label>
      </div>
      <footer className="accountSettingsSave"><span>{profileDirty ? t("有尚未保存的资料修改", "Profile changes are not saved yet") : t("当前资料与服务端一致", "Profile matches the server")}</span><button type="button" className="cp2Primary" disabled={!profileDirty || savingProfile} onClick={saveProfile}>{savingProfile ? t("保存中…", "Saving…") : t("保存个人资料", "Save profile")}</button></footer>
    </section>

    <section className="cp2Card accountSettingsCard">
      <header className="accountSettingsHead"><span><ShieldCheck/></span><div><b>{t("登录保护", "Sign-in Protection")}</b><small>{t("密码和 MFA 只影响身份验证，不改变交易模式", "Passwords and MFA affect identity only, never trading mode")}</small></div><InlineStatus tone={mfaEnabled ? "good" : "warn"}>{mfaEnabled ? t("MFA 已启用", "MFA enabled") : t("建议启用 MFA", "MFA recommended")}</InlineStatus></header>
      {!user.isOwner && <div className="accountSecuritySection"><div className="accountSecurityTitle"><Lock/><span><b>{t("修改密码", "Change Password")}</b><small>{t("修改成功后保留当前安全策略", "Your current security policy remains in force")}</small></span></div><div className="accountPasswordGrid"><label>{t("当前密码", "Current password")}<input type="password" autoComplete="current-password" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)}/></label><label>{t("新密码（至少 10 位）", "New password (10+ characters)")}<input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)}/></label><label>{t("确认新密码", "Confirm new password")}<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)}/></label></div><button type="button" className="cp2Secondary" onClick={changePassword}>{t("更新密码", "Update password")}</button></div>}
      {user.isOwner && <div className="accountOwnerPasswordNote"><KeyRound/><span><b>{t("Owner 密码由下方服务器安全配置管理", "The Owner password is managed by the server security configuration below")}</b><small>{t("密码原文不会回显；修改后现有会话按安全版本失效。", "The password is never displayed; existing sessions are revoked by security version after a change.")}</small></span></div>}
      <div className="accountSecuritySection"><div className="accountSecurityTitle"><ShieldCheck/><span><b>{t("双因素认证（TOTP）", "Two-Factor Authentication (TOTP)")}</b><small>{mfaEnabled ? t("登录时必须输入认证器生成的 6 位验证码", "Sign-in requires the six-digit code from your authenticator") : t("密钥加密保存在服务器，不发送给第三方", "The secret is encrypted on the server and never sent to third parties")}</small></span></div><div className="accountPasswordGrid"><label>{t("当前登录密码", "Current sign-in password")}<input type="password" autoComplete="current-password" value={mfaPassword} onChange={(event) => setMfaPassword(event.target.value)}/></label>{(mfaEnabled || mfaEnrollment) && <label>{t("6 位动态验证码", "Six-digit verification code")}<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))}/></label>}</div>{mfaEnrollment && <div className="accountMfaSecret"><small>{t("认证器密钥（只显示本次）", "Authenticator secret (shown once)")}</small><code>{mfaEnrollment.secret}</code><p>{t("将密钥添加到认证器，再输入当前验证码完成启用。", "Add the secret to your authenticator, then enter the current code to finish setup.")}</p></div>}<div className="cp2FormActions">{!mfaEnabled && !mfaEnrollment && <button type="button" className="cp2Primary" onClick={startMfaEnrollment}>{t("开始配置 MFA", "Set up MFA")}</button>}{mfaEnrollment && <button type="button" className="cp2Primary" disabled={mfaCode.length !== 6} onClick={confirmMfa}>{t("确认启用", "Enable MFA")}</button>}{mfaEnabled && <button type="button" className="cp2Secondary dangerText" disabled={mfaCode.length !== 6} onClick={disableMfa}>{t("验证并停用", "Verify and disable")}</button>}</div></div>
    </section>
  </div>;
}
