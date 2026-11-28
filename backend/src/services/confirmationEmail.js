import { publicOrigin } from './newsroomPhoto.js';

const escape = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

export function confirmationEmail(link) {
  const action = escape(link);
  const site = escape(publicOrigin);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Confirm your Daily Brief subscription</title></head>
<body style="margin:0;background:#eeecf3;color:#241f2d;font-family:Arial,Helvetica,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">Confirm your address to receive cybersecurity reporting from Nigeria, Africa and around the world.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eeecf3"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#fffefa;border:1px solid #d9d5df">
<tr><td bgcolor="#30203e" style="padding:22px 26px;color:#fffefa;font:700 32px Georgia,serif">Novr<i style="color:#d4b4f4">Pulse</i></td></tr>
<tr><td style="padding:28px 26px 4px"><table role="presentation" width="100%"><tr>
<td style="font:700 12px Arial,sans-serif;color:#4353a3;letter-spacing:2px">THE DAILY BRIEF</td>
<td align="right"><img src="${site}/apple-touch-icon.png" width="68" height="68" alt="NovrPulse kingfisher" style="display:block;border-radius:12px"></td></tr></table></td></tr>
<tr><td style="padding:0 26px 30px">
<h1 style="font:700 37px/1.08 Georgia,serif;letter-spacing:-1px;margin:12px 0 16px;color:#241f2d">Confirm your subscription.</h1>
<p style="font:16px/1.55 Arial,sans-serif;margin:0 0 22px">Get cybersecurity reporting from Nigeria, across Africa and around the world, delivered to your inbox.</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#632d8a" style="border-radius:8px;mso-padding-alt:14px 22px"><a href="${action}" style="display:inline-block;padding:14px 22px;font:bold 16px Arial,sans-serif;color:#ffffff;text-decoration:none">Confirm email address</a></td></tr></table>
<p style="font:14px/1.5 Arial,sans-serif;color:#5a5361;margin:20px 0 0">This link is valid for 24 hours. If you didn’t request the Daily Brief, you can ignore this email.</p>
</td></tr>
<tr><td bgcolor="#f1edf5" style="padding:16px 26px;border-top:1px solid #d9d5df;font:italic 14px Georgia,serif;color:#453a51">A <a href="https://cybernovr.com"><img src="${site}/press/cybernovr-wordmark.png" width="90" alt="CyberNovr" style="vertical-align:middle;border:0"></a> publication</td></tr>
</table></td></tr></table></body></html>`;
}
