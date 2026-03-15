// src/pages/rss.xml.js
import rss from '@astrojs/rss';
import { CONFIG } from '../config';

export async function GET(context) {
  const parseHandle = (handle) => {
      if (!handle) return { username: null, instance: null, domain: null };
      const clean = handle.startsWith('@') ? handle.slice(1) : handle;
      const parts = clean.split('@');
      if (parts.length < 2) return { username: 'error', instance: 'https://sshup.com', domain: 'sshup.com' };
      let domain = parts[1];
      if (domain.endsWith('/')) domain = domain.slice(0, -1);
      return { username: parts[0], instance: `https://${domain}`, domain: domain };
  };

  const { username: USER_NAME, instance: INSTANCE_URL, domain: DOMAIN } = parseHandle(CONFIG.FEDIVERSE_HANDLE);
  let rawItems = [];

  if (USER_NAME) {
      try {
          const headers = { 
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
              "Accept": "application/json"
          };
          let userId = null;
          let platform = 'unknown';

          // Misskey
          try {
              const mkRes = await fetch(`${INSTANCE_URL}/api/users/show`, {
                  method: "POST", headers: { "Content-Type": "application/json", ...headers },
                  body: JSON.stringify({ username: USER_NAME }),
              });
              if (mkRes.ok) { userId = (await mkRes.json()).id; platform = 'misskey'; }
          } catch(e) {}

          // Mastodon (突破拦截版)
          if (!userId) {
              try {
                  let mstdRes = await fetch(`${INSTANCE_URL}/api/v1/accounts/lookup?acct=${USER_NAME}`, { headers });
                  if (!mstdRes.ok) mstdRes = await fetch(`${INSTANCE_URL}/api/v1/accounts/lookup?acct=${USER_NAME}@${DOMAIN}`, { headers });
                  if (mstdRes.ok) { 
                      userId = (await mstdRes.json()).id; 
                      platform = 'mastodon'; 
                  } else {
                      let searchRes = await fetch(`${INSTANCE_URL}/api/v2/search?q=${USER_NAME}&type=accounts&limit=1`, { headers });
                      if (searchRes.ok) {
                          const searchData = await searchRes.json();
                          if (searchData.accounts && searchData.accounts.length > 0) {
                              userId = searchData.accounts[0].id;
                              platform = 'mastodon';
                          }
                      }
                  }
              } catch(e) {}
          }

          if (userId) {
              if (platform === 'misskey') {
                  const res = await fetch(`${INSTANCE_URL}/api/users/notes`, {
                      method: "POST", headers: { "Content-Type": "application/json", ...headers },
                      body: JSON.stringify({ userId: userId, limit: 30, includeReplies: false, includeMyRenotes: true }),
                  });
                  if (res.ok) {
                      const notes = await res.json();
                      rawItems.push(...notes.map(n => ({
                          title: (n.renote ? '🔄 ' : '') + (n.text ? n.text.substring(0, 50) : '[分享图片]'),
                          pubDate: new Date(n.createdAt),
                          description: n.text || '点击查看内容',
                          link: `https://${DOMAIN}/notes/${n.id}`
                      })));
                  }
              } else {
                  // 取消了 exclude_replies=true 并在本地过滤 (只保留与自己的回复，过滤别人的聊天)
                  const res = await fetch(`${INSTANCE_URL}/api/v1/accounts/${userId}/statuses?limit=30`, { headers });
                  if (res.ok) {
                      const mstdNotes = await res.json();
                      rawItems.push(...mstdNotes
                          .filter(n => !n.in_reply_to_account_id || n.in_reply_to_account_id === n.account.id)
                          .map(n => ({
                              title: (n.reblog ? '🔄 ' : '') + (n.content.replace(/<[^>]+>/g, '').substring(0, 50) || '[分享图片]'),
                              pubDate: new Date(n.created_at),
                              description: n.content,
                              link: `${INSTANCE_URL}/@${USER_NAME}/${n.id}`
                          })));
                  }
              }
          }
      } catch (e) { console.error("Fediverse Fetch Error", e); }
  }

  const PAGE_TITLE = CONFIG.SITE_TITLE;
  const SITE_URL = context.site || 'https://blog.sshup.com';

  return rss({
    title: PAGE_TITLE,
    description: CONFIG.SITE_DESC,
    site: SITE_URL,
    customData: `
      <image>
        <url>${CONFIG.SITE_ICON}</url>
        <title>${PAGE_TITLE}</title>
        <link>${SITE_URL}</link>
      </image>
      <generator>Misskey-Blog Astro</generator>
    `,
    items: rawItems,
  });
}