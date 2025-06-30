console.log('🟢 client.js loaded');
document.addEventListener('DOMContentLoaded', () => {
  // 1) username + room
  let username = sessionStorage.getItem('bc_username');
  if (!username) {
    username = prompt('Enter display name:')?.trim() 
             || 'Guest' + Math.floor(Math.random() * 1000);
    sessionStorage.setItem('bc_username', username);
  }
  document.getElementById('user-label').textContent = username;

  let room = sessionStorage.getItem('bc_room');
  if (!room) {
    room = prompt('Enter room name:')?.trim().toLowerCase();
    sessionStorage.setItem('bc_room', room);
  }
  document.getElementById('room-label').textContent = room;

  let currentMods = [];  // track moderators

  // 2) Socket & DOM refs
  const socket       = io();
  window.chatSocket = socket;
  const embedPlayer  = document.getElementById('embed-player');
  const userList     = document.getElementById('user-list');
  const forceBtn     = document.getElementById('force-play-next');
  const chatMessages = document.getElementById('chat-messages');
  const changeBtn    = document.getElementById('change-name');
  const sendBtn      = document.getElementById('send');
  const msgInput     = document.getElementById('message');
  const reqForm      = document.getElementById('request-form');
  const reqInput     = document.getElementById('request-input');
  const queueList    = document.getElementById('queue-list');
  const nextPreview  = document.getElementById('next-up-preview');
  const playNextBtn  = document.getElementById('play-next');
  const themeBtn     = document.getElementById('theme-toggle');
  const ignoredUsers = new Set();
  const changeRoomBtn= document.getElementById('change-room');


// ── GET A PRETTY TITLE ──
// Returns the real title for YouTube & Spotify (via oEmbed),
// otherwise just the last bit of the URL cleaned up.
// ── pretty titles for votes (artist + track) ──
async function getPrettyTitle(rawUrl) {
  const url = rawUrl.trim();

  // 1) SoundCloud via oEmbed
  if (/^(?:https?:\/\/)?(?:www\.)?soundcloud\.com\//.test(url)) {
    try {
      const res = await fetch(
        'https://soundcloud.com/oembed?format=json&url=' +
        encodeURIComponent(url.split('?')[0])
      );
      if (res.ok) {
        const { title } = await res.json();
        return title;          // e.g. "Forss – Flickermood"
      }
    } catch {
      /* fall through to slug */
    }
  }

// 2) Mixcloud via their JSON API (artist + show)
if (/^(?:https?:\/\/)?(?:www\.)?mixcloud\.com\//.test(url)) {
  // extract "/user/slug"
  const m = url.split('?')[0].match(
    /^https?:\/\/(?:www\.)?mixcloud\.com\/([^\/]+)\/([^\/]+)\/?/
  );
  if (m) {
    const userSlug = m[1];
    const showSlug = m[2];
    try {
      const apiRes = await fetch(
        `https://api.mixcloud.com/${userSlug}/${showSlug}/?metadata=1`
      );
      if (apiRes.ok) {
        const data = await apiRes.json();
        // data.user.name is the display name, data.name is the show title
        return `${data.user.name} – ${data.name}`;
      }
    } catch {
      // fall back to slug if anything goes wrong
    }
  }
  // if it didn’t match or API call failed, still try oEmbed:
  try {
    const oc = url.endsWith('/') ? url : url + '/';
    const res = await fetch(
      'https://api.mixcloud.com/oembed?format=json&url=' +
      encodeURIComponent(oc)
    );
    if (res.ok) {
      return (await res.json()).title;
    }
  } catch {
      /* fall through */
    }
  }

  // 3) YouTube via oEmbed
  if (/^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)/.test(url)) {
    try {
      const res = await fetch(
        'https://www.youtube.com/oembed?format=json&url=' +
        encodeURIComponent(url)
      );
      if (res.ok) {
        const { title } = await res.json();
        return title;          // e.g. "Artist – Track"
      }
    } catch {
      /* fall through */
    }
  }

  // 4) Spotify via oEmbed
  if (/^https?:\/\/open\.spotify\.com\/(track|album|playlist)\//.test(url)) {
    try {
      const res = await fetch(
        'https://open.spotify.com/oembed?format=json&url=' +
        encodeURIComponent(url.split('?')[0])
      );
      if (res.ok) {
        const { title } = await res.json();
        return title;          // e.g. "Artist – Track"
      }
    } catch {
      /* fall through */
    }
  }

  // 5) Fallback to last URL segment
  const slug = url
    .split('/')
    .filter(Boolean)
    .pop()
    .replace(/[-_]+/g, ' ');
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

  // 3) Handle “Suggest a Track” form submit
reqForm.addEventListener('submit', e => {
  e.preventDefault();
  const raw = reqInput.value.trim();
  if (!raw) return alert('Paste a URL or <iframe> snippet.');
  socket.emit('request track', { url: raw, requestedBy: username });
  reqInput.value = '';
});

  // 4) join + name-change flow
  let awaitingJoin = true;
  socket.emit('join', room, username);
  socket.emit('request users');

  socket.on('name taken', taken => {
    const wasJoin = awaitingJoin;
    let newName;
    do {
      newName = prompt(`"${taken}" is taken—choose another:`)?.trim()
             || 'Guest' + Math.floor(Math.random() * 1000);
    } while (newName === taken);
    const old = username;
    username = newName;
    sessionStorage.setItem('bc_username', username);
    document.getElementById('user-label').textContent = username;
    if (wasJoin) {
      socket.emit('join', room, username);
    } else {
      socket.emit('name change', { oldName: old, newName: username });
    }
  });

  // 5) Room users & mods (also show Rename Room for mods)
// Unified users+mods rendering
socket.on('room users', users => {
  userList.innerHTML = '';

  const forceBtn = document.getElementById('force-play-next');
  if (currentMods.includes(username)) {
    forceBtn.style.display = '';       // show if I'm a mod
  } else {
    forceBtn.style.display = 'none';   // hide otherwise
  }

  users.forEach(name => {
    const li   = document.createElement('li');
    li.style.display      = 'flex';
    li.style.alignItems   = 'center';

    // 1) Name + ★ for mods
    const span = document.createElement('span');
    span.textContent     = name + (currentMods.includes(name) ? ' ★' : '');
    span.style.flexGrow  = '1';
    li.appendChild(span);

    // 2) Ban & Kick buttons for mods
    if (currentMods.includes(username) && name !== username) {
      // Ban
      const banBtn = document.createElement('button');
      banBtn.textContent = '⛔';
      banBtn.title       = 'Ban user';
      banBtn.className   = 'action-btn';
      banBtn.onclick     = () => socket.emit('ban user', name);
      li.appendChild(banBtn);

      // Kick
      const kickBtn = document.createElement('button');
      kickBtn.textContent = '👟';
      kickBtn.title       = 'Kick user';
      kickBtn.className   = 'action-btn';
      kickBtn.onclick     = () => socket.emit('kick user', name);
      li.appendChild(kickBtn);
    }

    // 3) Ignore toggle for everyone else
if (name !== username && !currentMods.includes(name)) {
  const ignoreBtn = document.createElement('button');
  ignoreBtn.textContent = ignoredUsers.has(name) ? '😌' : '😒';
  ignoreBtn.title       = ignoredUsers.has(name) ? 'Unignore user' : 'Ignore user';
  ignoreBtn.className   = 'action-btn';
  ignoreBtn.onclick     = () => {
    if (ignoredUsers.has(name)) ignoredUsers.delete(name);
    else ignoredUsers.add(name);
    ignoreBtn.textContent = ignoredUsers.has(name) ? '😌' : '😒';
    ignoreBtn.title       = ignoredUsers.has(name) ? 'Unignore user' : 'Ignore user';
  };
  li.appendChild(ignoreBtn);
}

    userList.appendChild(li);
  });
});




// Keep track of who the mods are
socket.on('room mods', mods => {
  currentMods = mods;
 
changeRoomBtn.style.display = currentMods.includes(username)
  ? 'inline-block'
  : 'none';
 
  // Re-trigger a fresh render of users + stars + buttons
  socket.emit('request users');  
});


  // 6) Rename room (mods only)
  changeRoomBtn.addEventListener('click', () => {
    const oldRoom = room;
    const candidate = prompt('Enter a new room name:', room);
    if (!candidate) return;
    const newRoom = candidate.trim().toLowerCase();
    if (newRoom === room) return;
    room = newRoom;
    sessionStorage.setItem('bc_room', room);
    document.getElementById('room-label').textContent = room;
    socket.emit('change room', { oldRoom, newRoom });
  });

  // 7) Presence alerts (join/leave/name-change)
  socket.on('user joined', who => addAction(`${who} just entered the chat`));
  socket.on('user left',   who => addAction(`${who} has left the chat`));
  socket.on('name change', ({ oldName, newName }) => {
    if (username === oldName) {
      username = newName;
      sessionStorage.setItem('bc_username', newName);
      document.getElementById('user-label').textContent = newName;
    }
    addAction(`${oldName} is now known as ${newName}`);
  });
  function addAction(text) {
    const d = document.createElement('div');
    d.className = 'user-action';
    d.textContent = text;
    chatMessages.append(d);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
  
socket.on('user action', async ({ type, username: who, url }) => {
  const title = await getPrettyTitle(url);
  const div   = document.createElement('div');
  div.className = 'user-action';
  div.textContent = `${who} ${
    type === 'upvote' ? 'upvoted' : 'downvoted'
  } “${title}”`;
  chatMessages.append(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
});
socket.on('error', err => {
  const div = document.createElement('div');
  div.className   = 'user-action';
  div.textContent = `Error: ${err}`;
  chatMessages.append(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
});


  // 8) Change-name button
  changeBtn.addEventListener('click', () => {
    const old = username;
    const n   = prompt('New display name:', old)?.trim();
    if (n && n !== old) {
      awaitingJoin = false;
      socket.emit('name change', { oldName: old, newName: n });
    }
  });

  // 9) Chat send/receive
  sendBtn.addEventListener('click', () => {
    const t = msgInput.value.trim();
    if (!t) return;
    socket.emit('chat message', { text: t, username });
    msgInput.value = '';
  });
  
  socket.on('chat message', ({ text, username: from, timestamp }) => {
  if (ignoredUsers.has(from)) return;    // ← drop ignored
  const d = document.createElement('div');
  d.textContent = `${from}: ${text}`;
  chatMessages.append(d);
  chatMessages.scrollTop = chatMessages.scrollHeight;
});


 // 10) Utility: embed any supported URL, now with Bandcamp support
function getEmbedHTML(input) {
  const v = input.trim();

  // 0) Raw Bandcamp iframe snippet (their “Embed Player” code)
  if (/^<iframe[^>]+bandcamp\.com\/EmbeddedPlayer/.test(v)) {
    return `<div class="embed-container">${v}</div>`;
  }

  // 1) Bandcamp page URL (track or album) → generate embed iframe
  if (/^https?:\/\/[^\/]+\.bandcamp\.com\/(?:track|album)\//.test(v)) {
    const clean = v.split('?')[0];
    const src = [
      'https://bandcamp.com/EmbeddedPlayer/',
      'url=' + encodeURIComponent(clean),
      '/size=large',
      '/bgcol=ffffff',
      '/linkcol=0687f5',
      '/transparent=true'
    ].join('');
    return `
      <div class="embed-container">
        <iframe
          style="border:0;width:100%;height:470px;"
          src="${src}"
          seamless>
        </iframe>
      </div>
    `.trim();
  }

  // 2) Raw <iframe> passthrough (SoundCloud/Mixcloud/anything else)
  if (/^<iframe/i.test(v)) {
    return `<div class="embed-container">${v}</div>`;
  }

  // 2) SoundCloud
  if (/^https?:\/\/(soundcloud\.com|snd\.sc)\//.test(v)) {
    const clean = v.split('?')[0];
    const src = [
      'https://w.soundcloud.com/player/',
      '?url=' + encodeURIComponent(clean),
      '&color=%23ff5500',
      '&auto_play=false',
      '&hide_related=false',
      '&show_comments=true',
      '&show_user=true',
      '&show_reposts=false'
    ].join('');
    return `<iframe width="100%" height="166" scrolling="no" frameborder="no" allow="autoplay" src="${src}"></iframe>`;
  }

  // 3) YouTube (full & short URLs)
  const yt = v.match(
    /^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  if (yt) {
    return `<iframe
              width="560" height="315"
              src="https://www.youtube.com/embed/${yt[1]}"
              frameborder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowfullscreen>
            </iframe>`;
  }

  // 4) Spotify
  const sp = v.match(/open\.spotify\.com\/(track|album|playlist)\/([A-Za-z0-9]+)/);
  if (sp) {
    return `<iframe
              src="https://open.spotify.com/embed/${sp[1]}/${sp[2]}"
              width="300" height="380"
              frameborder="0"
              allowtransparency="true"
              allow="encrypted-media">
            </iframe>`;
  }

  // 5) Mixcloud
  if (/mixcloud\.com\//.test(v)) {
    const clean = v.split('?')[0].replace(/\/?$/, '/');
    return `<iframe
              width="100%" height="120"
              src="https://www.mixcloud.com/widget/iframe/?feed=${encodeURIComponent(clean)}"
              frameborder="0">
            </iframe>`;
  }

  // 6) fallback
  return `<div>Unsupported URL: <a href="${v}" target="_blank">${v}</a></div>`;
}


  // 11) Queue updates & voting
  let latest = [];
socket.on('queue updated', q => {
  latest = q;
  queueList.innerHTML = '';

  q.slice().reverse().forEach((item, rev) => {
    const idx = q.length - 1 - rev;
    const li  = document.createElement('li');
li.innerHTML = `
  <div class="vote-controls">
    <strong>${item.votes} votes</strong>
    <button class="up">👍</button>
    <button class="dn">👎</button>
  </div>
  <div class="embed-container">
    ${getEmbedHTML(item.url)}
  </div>
  <div class="requested-by">Requested by: ${item.requestedBy}</div>
`;

    li.querySelector('.up').onclick = () => socket.emit('vote track',   { idx, username });
    li.querySelector('.dn').onclick = () => socket.emit('downvote track', { idx, username });
    queueList.append(li);
  });

  if (q.length) {
    // only update the Next-Up preview
   nextPreview.innerHTML = `
  <div class="embed-container">
    ${getEmbedHTML(
      latest.reduce((a,b) => b.votes > a.votes ? b : a, latest[0]).url
    )}
  </div>
`;
    playNextBtn.disabled = false;
  } else {
    nextPreview.innerHTML = '<em>No suggestions yet</em>';
    playNextBtn.disabled = true;
  }
});

  // 12) Play next / force-play
  playNextBtn.addEventListener('click', () => {
    if (!latest.length) return;
    socket.emit('play track', {
      url: latest.reduce((a,b) => b.votes > a.votes ? b : a, latest[0]).url
    });
  });
  forceBtn.addEventListener('click', () => {
    if (!latest.length) return;
    socket.emit('force play track', {
      url: latest.reduce((a,b) => b.votes > a.votes ? b : a, latest[0]).url
    });
  });

  // 13) Play track at
 socket.on('play track at', ({ url }) => {
  // 1) Insert only what getEmbedHTML returns — it already wraps in <div.embed-container>
  embedPlayer.innerHTML = getEmbedHTML(url);

  // 2) Overlay logic (unchanged)
  const overlay = document.createElement('div');
  overlay.className   = 'play-overlay';
  overlay.textContent = '▶ Play Track';
  embedPlayer.appendChild(overlay);
  overlay.addEventListener('click', () => {
    overlay.remove();
    const ifr = embedPlayer.querySelector('iframe');
    if (ifr && ifr.src.includes('soundcloud.com')) SC.Widget(ifr).play();
  });

  // 3) Rebind finish event for SoundCloud
  const ifr2 = embedPlayer.querySelector('iframe');
  if (ifr2 && ifr2.src.includes('soundcloud.com')) {
    const w = SC.Widget(ifr2);
    w.unbind(SC.Widget.Events.FINISH);
    w.bind(SC.Widget.Events.FINISH, () => socket.emit('track ended'));
  }
});


  // 14) Theme toggle
  themeBtn.addEventListener('click', () => {
    const d = document.body.classList.toggle('dark');
    localStorage.setItem('bc_theme', d ? 'dark' : 'light');
  });
  if (localStorage.getItem('bc_theme') === 'dark') {
    document.body.classList.add('dark');
  }
})
// MOBILE SIDEBAR TOGGLE
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebar       = document.querySelector('.sidebar');
const mainEl        = document.querySelector('main');

sidebarToggle.addEventListener('click', () => {
  sidebar.classList.toggle('open');
  mainEl.classList.toggle('shifted');
});