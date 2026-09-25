import { html } from './html.js';
import { BRAND } from '../brand.js';

// Plain-text + HTML email bodies. Names are escaped in the HTML version like
// everywhere else; links are built only from the configured APP_URL.

function wrap(title, paragraphs, button) {
  return html`<!doctype html><html><body style="margin:0;background:#07080f;font-family:Arial,Helvetica,sans-serif;color:#e9ebf5">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="100%" style="max-width:520px;background:#10131f;border:1px solid #232842;border-radius:14px">
  <tr><td style="padding:28px">
    <p style="margin:0 0 20px;font-weight:bold;letter-spacing:0.08em;text-transform:uppercase;font-size:13px;color:#ff7a3d">🚀 ${BRAND.name}</p>
    <h1 style="margin:0 0 16px;font-size:22px;color:#ffffff">${title}</h1>
    ${paragraphs.map((p) => html`<p style="margin:0 0 14px;line-height:1.55">${p}</p>`)}
    ${button ? html`<p style="margin:24px 0"><a href="${button.url}" style="background:#ff6a2b;color:#ffffff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">${button.label}</a></p>
      <p style="margin:0 0 14px;font-size:12px;color:#9aa1bd">Or paste this link into your browser:<br>${button.url}</p>` : ''}
    <p style="margin:24px 0 0;font-size:12px;color:#9aa1bd">If you didn't request this, you can safely ignore this email.</p>
  </td></tr></table></td></tr></table></body></html>`.toString();
}

export function activationEmail({ name, url }) {
  return {
    subject: `Activate your ${BRAND.name} account`,
    text: `Hi ${name},\n\nWelcome to ${BRAND.name}! Confirm this is your email address to activate your account:\n\n${url}\n\nThis link expires in 24 hours. If you didn't sign up, ignore this email.`,
    html: wrap(`Welcome, ${name}`, [`Confirm this is your email address to activate your ${BRAND.name} account. The link expires in 24 hours.`], { url, label: 'Activate my account' }),
  };
}

export function alreadyRegisteredEmail({ name, loginUrl, resetUrl }) {
  return {
    subject: `You already have a ${BRAND.name} account`,
    text: `Hi ${name},\n\nSomeone (hopefully you) tried to sign up with this email address, but you already have an account.\n\nSign in: ${loginUrl}\nForgot your password? ${resetUrl}\n\nIf this wasn't you, no action is needed.`,
    html: wrap('You already have an account', [`Someone (hopefully you) tried to sign up with this email address, but you already have an account. You can sign in, or reset your password if you've forgotten it.`], { url: resetUrl, label: 'Reset my password' }),
  };
}

export function resetEmail({ name, url }) {
  return {
    subject: `Reset your ${BRAND.name} password`,
    text: `Hi ${name},\n\nUse this link to choose a new password. It expires in 1 hour and can only be used once:\n\n${url}\n\nIf you didn't ask for this, ignore this email — your password won't change.`,
    html: wrap('Reset your password', ['Use the button below to choose a new password. The link expires in 1 hour and can only be used once.'], { url, label: 'Choose a new password' }),
  };
}

export function passwordChangedEmail({ name, resetUrl }) {
  return {
    subject: `Your ${BRAND.name} password was changed`,
    text: `Hi ${name},\n\nYour password was just changed and all other devices were signed out.\n\nIf this wasn't you, reset your password immediately: ${resetUrl}`,
    html: wrap('Your password was changed', ['Your password was just changed and all other devices were signed out.', "If this wasn't you, reset your password immediately."], { url: resetUrl, label: 'Reset my password' }),
  };
}
