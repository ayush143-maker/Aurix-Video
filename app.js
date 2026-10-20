'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const AUDIO = $('audioElement');
  const VIDEO = $('videoElement');
  const VIDEO_AUDIO = $('videoAudio');
  const state = {
    results: [],
    queue: [],
    currentIndex: -1,
    currentTrack: null,
    streamInfo: null,
    streamApi: null,
    searchToken: 0,
    selectToken: 0,
    busy: false,
    shuffle: false,
    repeat: false,
    liked: false,
    videoOpen: false,
    videoWasPlaying: false,
    videoCompanionAudio: false,
    videoFit: false,
    videoStartingAt: 0,
    toastTimer: null
  };

  function safeText(value) { return String(value ?? '').trim(); }
  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}` : `${minutes}:${String(secs).padStart(2, '0')}`;
  }
  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function showToast(message, ms = 2600) {
    const toast = $('toast');
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove('visible'), ms);
  }
  function loadingButton(isLoading) {
    $('playSpinner').hidden = !isLoading;
    $('playIcon').hidden = isLoading;
    $('playButton').disabled = isLoading;
    $('playButton').setAttribute('aria-label', isLoading ? 'Loading stream' : (AUDIO.paused ? 'Play' : 'Pause'));
  }
  function setPlayIcon(playing) {
    $('playIcon').innerHTML = playing
      ? '<path d="M7 5v14M17 5v14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>'
      : '<path d="m8 5 12 7-12 7z"/>';
    $('playButton').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }
  function setVideoPlayIcon(playing) {
    $('videoPlayIcon').innerHTML = playing
      ? '<path d="M7 5v14M17 5v14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>'
      : '<path d="m8 5 12 7-12 7z" fill="currentColor"/>';
    $('videoPlay').setAttribute('aria-label', playing ? 'Pause video' : 'Play video');
  }
  function setRange(input, fraction) {
    const value = Math.max(0, Math.min(1, Number(fraction) || 0)) * 100;
    input.style.setProperty('--fill', `${value}%`);
    input.value = String(Math.round(value * 10));
  }
  function readRange(input) { return Number(input.value) / 1000; }
  function videoIdFromResult(item) {
    const source = safeText(item.url || item.id || item.videoId);
    const match = source.match(/[?&]v=([A-Za-z0-9_-]{11})/) || source.match(/\/watch\/([A-Za-z0-9_-]{11})/) || source.match(/([A-Za-z0-9_-]{11})/);
    return match ? match[1] : '';
  }
  // All Piped JSON requests go through same-origin Vercel Functions.
  // The browser no longer calls public Piped hosts directly (CORS can block them).
  async function fetchFromPiped(path, options = {}) {
    const timeoutMs = Math.max(Number(options.timeoutMs) || 0, 9000);
    let endpoint;
    if (path.startsWith('/search?')) {
      endpoint = '/api/piped/search' + path.slice('/search'.length);
    } else {
      const match = path.match(/^\/streams\/([A-Za-z0-9_-]{11})$/);
      if (!match) throw new Error('Unsupported Piped API route.');
      endpoint = '/api/piped/streams?id=' + encodeURIComponent(match[1]);
    }
    let preferred = options.preferred || '';
    if (!preferred) {
      try { preferred = localStorage.getItem('aurix-piped-instance') || ''; } catch (_) { /* storage is optional */ }
    }
    if (preferred) endpoint += (endpoint.includes('?') ? '&' : '?') + 'preferred=' + encodeURIComponent(preferred);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        signal: controller.signal,
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });
      let payload;
      try { payload = await response.json(); }
      catch (_) { throw new Error(`Aurix API relay returned invalid JSON (HTTP ${response.status}).`); }
      if (!response.ok) throw new Error(payload.error || `Aurix API relay failed (HTTP ${response.status}).`);
      if (!payload || !payload.data || typeof payload.data !== 'object') throw new Error('Aurix API relay returned an invalid Piped response.');
      if (payload.host) {
        try { localStorage.setItem('aurix-piped-instance', payload.host); } catch (_) { /* storage is optional */ }
      }
      const data = payload.data;
      const validator = options.validator || ((value) => value && typeof value === 'object');
      if (!validator(data)) throw new Error('The Piped instance returned an unexpected response.');
      return { data, host: payload.host || 'Piped via Aurix API relay' };
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('Aurix API relay timed out. The server may be busy or no Piped instance responded.');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  function renderResults(items, host) {
    const list = $('resultsList');
    list.innerHTML = '';
    if (!items.length) {
      list.innerHTML = '<div class="empty-state"><span class="error-title">No tracks found</span>Try a different song or artist name.</div>';
      $('resultCount').textContent = '0 tracks';
      return;
    }
    $('resultCount').textContent = `${items.length} tracks`;
    const fragment = document.createDocumentFragment();
    items.forEach((track, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'result-card';
      const thumbnailMarkup = track.thumbnail
        ? `<img loading="lazy" src="${escapeHtml(track.thumbnail)}" alt="" referrerpolicy="no-referrer">`
        : '<span class="thumb-placeholder">Λ</span>';
      button.innerHTML = `
        <span class="result-thumb">${thumbnailMarkup}<span class="result-duration">${escapeHtml(formatTime(track.duration))}</span></span>
        <span class="result-copy"><strong class="result-title">${escapeHtml(track.title || 'Untitled track')}</strong><small class="result-sub">${escapeHtml(track.uploader || 'YouTube video')} · ${escapeHtml(track.uploadedDate || 'Piped')}</small></span>
        <span class="result-play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m8 5 12 7-12 7z"/></svg></span>`;
      button.addEventListener('click', () => selectTrack(index, true));
      fragment.appendChild(button);
    });
    list.appendChild(fragment);
  }

  async function runSearch(query) {
    const cleanQuery = safeText(query);
    if (!cleanQuery) { $('searchInput').focus(); return; }
    const token = ++state.searchToken;
    $('homeIntro').hidden = true;
    $('resultsSection').hidden = false;
    $('resultsTitle').textContent = cleanQuery;
    $('resultCount').textContent = '';
    $('resultsList').innerHTML = '<div class="home-loading"><span class="mini-spinner"></span><span>Searching through Aurix API relay…</span></div>';
    $('homeStatus').textContent = 'Routing search through Aurix API relay…';
    try {
      const { data, host } = await fetchFromPiped(`/search?q=${encodeURIComponent(cleanQuery)}&filter=music_videos`, {
        timeoutMs: 9000,
        validator: (payload) => payload && Array.isArray(payload.items)
      });
      if (token !== state.searchToken) return;
      const tracks = data.items
        .filter((item) => (!item.type || item.type === 'stream' || item.type === 'video') && videoIdFromResult(item))
        .map((item) => ({
          id: videoIdFromResult(item),
          title: safeText(item.title) || 'Untitled track',
          uploader: safeText(item.uploaderName || item.uploader || item.channelName) || 'YouTube video',
          thumbnail: safeText(item.thumbnail || item.thumbnailUrl),
          duration: Number(item.duration) || 0,
          views: Number(item.views) || 0,
          uploadedDate: safeText(item.uploadedDate),
          apiBase: host,
          streams: null
        }));
      state.results = tracks;
      state.queue = tracks.slice();
      renderResults(tracks, host);
      $('homeStatus').textContent = `Search via ${new URL(host).hostname} · stream availability varies by instance.`;
      if (!tracks.length) $('resultsList').innerHTML = '<div class="empty-state"><span class="error-title">No playable video results</span>Try another search phrase. Search results must include a video ID to play.</div>';
    } catch (error) {
      if (token !== state.searchToken) return;
      $('resultsList').innerHTML = `<div class="empty-state"><span class="error-title">Piped could not respond</span>${escapeHtml(error.message)}<br><br>The relay will retry several public instances. If it still fails, they may be down or blocking Vercel requests.</div>`;
      $('homeStatus').textContent = 'No stream provider connected right now.';
    }
  }

  async function getStreamInfo(track) {
    if (track.streams && track.streamHost) {
      state.streamInfo = track.streams;
      state.streamApi = track.streamHost;
      return { data: track.streams, host: track.streamHost };
    }
    const { data, host } = await fetchFromPiped(`/streams/${encodeURIComponent(track.id)}`, {
      preferred: track.apiBase,
      timeoutMs: 9000,
      validator: (payload) => payload && Array.isArray(payload.audioStreams) && Array.isArray(payload.videoStreams)
    });
    track.streams = data;
    track.streamHost = host;
    state.streamInfo = data;
    state.streamApi = host;
    return { data, host };
  }

  function bestAudioStream(info) {
    const streams = (info.audioStreams || []).filter((stream) => stream.url && !stream.videoOnly);
    streams.sort((a, b) => {
      const aM4a = /m4a|audio\/mp4/i.test(`${a.format || ''} ${a.mimeType || ''}`) ? 1 : 0;
      const bM4a = /m4a|audio\/mp4/i.test(`${b.format || ''} ${b.mimeType || ''}`) ? 1 : 0;
      if (aM4a !== bM4a) return bM4a - aM4a;
      return (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0);
    });
    return streams[0] || null;
  }
  function bestVideoStream(info) {
    const streams = (info.videoStreams || []).filter((stream) => stream.url && /video\/mp4/i.test(stream.mimeType || 'video/mp4'));
    const muxed = streams.filter((stream) => stream.videoOnly === false);
    const candidates = muxed.length ? muxed : streams;
    candidates.sort((a, b) => {
      const aHeight = Number(a.height) || 0;
      const bHeight = Number(b.height) || 0;
      const aPreferred = aHeight <= 720 ? aHeight : 720 - (aHeight - 720) * 1.5;
      const bPreferred = bHeight <= 720 ? bHeight : 720 - (bHeight - 720) * 1.5;
      return bPreferred - aPreferred;
    });
    return candidates[0] || null;
  }
  function paintTrack(track, info) {
    $('trackTitle').textContent = track.title;
    $('trackArtist').textContent = track.uploader;
    $('videoTitle').textContent = track.title;
    $('videoArtist').textContent = track.uploader;
    $('sourceLabel').textContent = state.streamApi ? new URL(state.streamApi).hostname.toUpperCase() : 'PIPED STREAM';
    const art = track.thumbnail || info?.thumbnailUrl || '';
    $('artwork').classList.remove('loaded');
    $('artworkFallback').hidden = false;
    if (art) {
      $('artwork').onload = () => { $('artwork').classList.add('loaded'); $('artworkFallback').hidden = true; };
      $('artwork').onerror = () => { $('artwork').classList.remove('loaded'); $('artworkFallback').hidden = false; };
      $('artwork').src = art;
      $('artworkGlow').style.backgroundImage = `url("${art.replace(/["\\]/g, '')}")`;
    } else {
      $('artwork').removeAttribute('src');
      $('artworkGlow').style.backgroundImage = 'none';
    }
    $('audioSeek').value = '0';
    $('audioSeek').style.setProperty('--fill', '0%');
    $('currentTime').textContent = '0:00';
    const length = Number(info?.duration || track.duration) || 0;
    $('totalTime').textContent = formatTime(length);
    $('videoCurrentTime').textContent = '0:00';
    $('videoTotalTime').textContent = formatTime(length);
    state.liked = false;
    $('likeButton').setAttribute('aria-pressed', 'false');
  }

  async function selectTrack(index, autoplay) {
    if (index < 0 || index >= state.queue.length) return;
    const selectionToken = ++state.selectToken;
    stopAllMedia();
    state.currentIndex = index;
    state.currentTrack = state.queue[index];
    state.streamInfo = null;
    state.streamApi = null;
    state.busy = true;
    $('homeScreen').hidden = true;
    $('videoScreen').hidden = true;
    $('playerScreen').hidden = false;
    loadingButton(true);
    $('sourceLabel').textContent = 'CONNECTING TO PIPED';
    paintTrack(state.currentTrack, null);
    try {
      const { data } = await getStreamInfo(state.currentTrack);
      const audioStream = bestAudioStream(data);
      if (!audioStream) throw new Error('This video has no compatible audio stream. Try another result.');
      if (selectionToken !== state.selectToken || state.currentTrack !== state.queue[index]) return;
      state.currentTrack.audioStream = audioStream;
      state.currentTrack.info = data;
      AUDIO.src = audioStream.url;
      AUDIO.load();
      paintTrack(state.currentTrack, data);
      state.busy = false;
      loadingButton(false);
      setPlayIcon(false);
      $('sourceLabel').textContent = `${new URL(state.streamApi).hostname.toUpperCase()} · AUDIO READY`;
      if (autoplay) {
        try { await AUDIO.play(); setPlayIcon(true); }
        catch (_) { showToast('Stream ready — tap play to start audio.'); }
      }
    } catch (error) {
      if (selectionToken !== state.selectToken) return;
      state.busy = false;
      loadingButton(false);
      $('sourceLabel').textContent = 'STREAM UNAVAILABLE';
      showToast(error.message || 'Could not load audio stream.', 3600);
    }
  }

  function stopAllMedia() {
    AUDIO.pause(); VIDEO.pause(); VIDEO_AUDIO.pause();
  }
  async function toggleAudio() {
    if (state.busy) return;
    if (!state.currentTrack) { showToast('Search for a song first.'); return; }
    if (!AUDIO.src) { showToast('No audio stream is loaded for this track.'); return; }
    try {
      if (AUDIO.paused) { await AUDIO.play(); setPlayIcon(true); }
      else { AUDIO.pause(); setPlayIcon(false); }
    } catch (_) { showToast('The stream could not start. Try selecting the track again.'); }
  }

  async function openVideoMode() {
    const track = state.currentTrack;
    if (state.busy) { showToast('Still connecting to the audio stream. Try Video in a moment.'); return; }
    if (!track) { showToast('Select a track before opening Video.'); return; }
    state.videoOpen = true;
    state.videoWasPlaying = !AUDIO.paused;
    state.videoStartingAt = Number(AUDIO.currentTime) || 0;
    AUDIO.pause();
    VIDEO.pause();
    VIDEO_AUDIO.pause();
    $('videoScreen').hidden = false;
    $('videoScreen').classList.remove('error', 'fit-mode');
    state.videoFit = false;
    $('videoLoading').classList.remove('done');
    $('videoLoadingText').textContent = 'Preparing Piped video stream…';
    $('videoHint').textContent = 'Portrait crop · phone stays upright';
    setVideoPlayIcon(false);
    try {
      const { data } = await getStreamInfo(track);
      if (state.currentTrack !== track || !state.videoOpen) return;
      const videoStream = bestVideoStream(data);
      const audioStream = bestAudioStream(data);
      if (!videoStream) throw new Error('No compatible MP4 video stream was returned by this Piped instance.');
      VIDEO.pause();
      VIDEO.removeAttribute('src');
      VIDEO.muted = videoStream.videoOnly === true;
      state.videoCompanionAudio = videoStream.videoOnly === true;
      VIDEO.src = videoStream.url;
      VIDEO.load();
      if (state.videoCompanionAudio) {
        if (!audioStream) throw new Error('Piped returned video without a compatible audio stream.');
        VIDEO_AUDIO.src = audioStream.url;
        VIDEO_AUDIO.load();
      } else {
        VIDEO_AUDIO.removeAttribute('src');
        VIDEO_AUDIO.load();
      }
      const seekWhenReady = () => {
        if (Number.isFinite(VIDEO.duration) && state.videoStartingAt > 0 && state.videoStartingAt < VIDEO.duration - 1) {
          try { VIDEO.currentTime = state.videoStartingAt; } catch (_) { /* Some streams do not allow a seek yet. */ }
        }
      };
      VIDEO.addEventListener('loadedmetadata', seekWhenReady, { once: true });
      VIDEO.addEventListener('canplay', () => $('videoLoading').classList.add('done'), { once: true });
      VIDEO.onerror = () => {
        if (state.videoOpen) {
          $('videoLoadingText').textContent = 'This stream could not be played. Try exiting and retrying.';
          $('videoScreen').classList.add('error');
          $('videoLoading').classList.remove('done');
        }
      };
      try {
        await VIDEO.play();
        if (state.videoCompanionAudio) {
          try { VIDEO_AUDIO.currentTime = VIDEO.currentTime; await VIDEO_AUDIO.play(); } catch (_) { showToast('Separate audio stream could not start.'); }
        }
        setVideoPlayIcon(true);
        $('videoLoading').classList.add('done');
      } catch (_) {
        $('videoLoading').classList.add('done');
        setVideoPlayIcon(false);
        showToast('Video is ready. Tap play to begin.');
      }
    } catch (error) {
      $('videoLoadingText').textContent = error.message || 'No compatible video stream was found.';
      $('videoScreen').classList.add('error');
      showToast(error.message || 'Video could not be loaded.', 3800);
    }
  }

  async function toggleVideoPlay() {
    if (!state.videoOpen) return;
    try {
      if (VIDEO.paused) {
        await VIDEO.play();
        if (state.videoCompanionAudio) {
          try { VIDEO_AUDIO.currentTime = VIDEO.currentTime; await VIDEO_AUDIO.play(); } catch (_) { /* show video even if separate audio failed */ }
        }
        setVideoPlayIcon(true);
      } else {
        VIDEO.pause(); VIDEO_AUDIO.pause(); setVideoPlayIcon(false);
      }
    } catch (_) { showToast('Playback failed for this video stream.'); }
  }

  function closeVideoMode() {
    if (!state.videoOpen) return;
    const resumeTime = Number(VIDEO.currentTime) || state.videoStartingAt || 0;
    const resumeAudio = state.videoWasPlaying && !VIDEO.paused;
    state.videoOpen = false;
    VIDEO.pause(); VIDEO_AUDIO.pause();
    $('videoScreen').hidden = true;
    $('videoLoading').classList.remove('done');
    if (AUDIO.src) {
      try { AUDIO.currentTime = resumeTime; } catch (_) { /* stream may be non-seekable */ }
      if (resumeAudio) AUDIO.play().then(() => setPlayIcon(true)).catch(() => { setPlayIcon(false); showToast('Back to player. Tap play to resume audio.'); });
      else setPlayIcon(false);
    }
  }

  function paintQueue() {
    const list = $('queueList');
    list.innerHTML = '';
    if (!state.queue.length) {
      list.innerHTML = '<div class="empty-state">Search for music to build your queue.</div>';
      return;
    }
    const fragment = document.createDocumentFragment();
    state.queue.forEach((track, index) => {
      const button = document.createElement('button');
      button.className = `queue-card${index === state.currentIndex ? ' current' : ''}`;
      button.type = 'button';
      const thumb = track.thumbnail ? `<img loading="lazy" src="${escapeHtml(track.thumbnail)}" alt="">` : '<span class="thumb-placeholder">Λ</span>';
      button.innerHTML = `<span class="queue-index">${index === state.currentIndex ? '♫' : String(index + 1).padStart(2, '0')}</span><span class="result-thumb">${thumb}</span><span class="result-copy"><strong class="result-title">${escapeHtml(track.title)}</strong><small class="result-sub">${escapeHtml(track.uploader)}</small></span>`;
      button.addEventListener('click', async () => { $('queueSheet').hidden = true; await selectTrack(index, true); });
      fragment.appendChild(button);
    });
    list.appendChild(fragment);
  }
  function showQueue() { paintQueue(); $('queueSheet').hidden = false; }
  function stepTrack(direction) {
    if (!state.queue.length) { showToast('Search for a track to make a queue.'); return; }
    let next = state.currentIndex + direction;
    if (state.shuffle && state.queue.length > 1) {
      do { next = Math.floor(Math.random() * state.queue.length); } while (next === state.currentIndex);
    } else if (next < 0) next = state.repeat ? state.queue.length - 1 : 0;
    else if (next >= state.queue.length) next = state.repeat ? 0 : state.queue.length - 1;
    const isSame = next === state.currentIndex;
    if (isSame && !state.repeat && direction > 0) { AUDIO.pause(); setPlayIcon(false); return; }
    const wasVideo = state.videoOpen;
    if (wasVideo) {
      state.videoOpen = false; VIDEO.pause(); VIDEO_AUDIO.pause(); $('videoScreen').hidden = true;
    }
    selectTrack(next, true).then(() => { if (wasVideo) openVideoMode(); });
  }

  $('searchForm').addEventListener('submit', (event) => { event.preventDefault(); runSearch($('searchInput').value); });
  $('searchInput').addEventListener('input', () => { $('clearSearch').hidden = !$('searchInput').value; });
  $('clearSearch').addEventListener('click', () => { $('searchInput').value = ''; $('clearSearch').hidden = true; $('searchInput').focus(); });
  $('collapsePlayer').addEventListener('click', () => { if (state.videoOpen) closeVideoMode(); $('playerScreen').hidden = true; $('homeScreen').hidden = false; });
  $('playButton').addEventListener('click', toggleAudio);
  $('nextButton').addEventListener('click', () => stepTrack(1));
  $('previousButton').addEventListener('click', () => stepTrack(-1));
  $('videoTab').addEventListener('click', openVideoMode);
  $('exitVideo').addEventListener('click', closeVideoMode);
  $('videoPlay').addEventListener('click', toggleVideoPlay);
  $('videoNext').addEventListener('click', () => stepTrack(1));
  $('videoPrev').addEventListener('click', () => stepTrack(-1));
  $('openQueueTop').addEventListener('click', showQueue);
  $('queueTab').addEventListener('click', showQueue);
  $('queueSheet').querySelectorAll('[data-close-sheet]').forEach((button) => button.addEventListener('click', () => { $('queueSheet').hidden = true; }));
  $('lyricsTab').addEventListener('click', () => showToast('Lyrics are not part of this player prototype.'));
  $('likeButton').addEventListener('click', () => {
    state.liked = !state.liked;
    $('likeButton').setAttribute('aria-pressed', String(state.liked));
  });
  $('shuffleButton').addEventListener('click', () => { state.shuffle = !state.shuffle; $('shuffleButton').setAttribute('aria-pressed', String(state.shuffle)); showToast(state.shuffle ? 'Shuffle on' : 'Shuffle off'); });
  $('repeatButton').addEventListener('click', () => { state.repeat = !state.repeat; $('repeatButton').setAttribute('aria-pressed', String(state.repeat)); showToast(state.repeat ? 'Repeat on' : 'Repeat off'); });

  $('audioSeek').addEventListener('input', () => {
    const progress = readRange($('audioSeek'));
    $('audioSeek').style.setProperty('--fill', `${progress * 100}%`);
    if (Number.isFinite(AUDIO.duration)) AUDIO.currentTime = AUDIO.duration * progress;
  });
  $('videoSeek').addEventListener('input', () => {
    const progress = readRange($('videoSeek'));
    $('videoSeek').style.setProperty('--fill', `${progress * 100}%`);
    if (Number.isFinite(VIDEO.duration)) {
      VIDEO.currentTime = VIDEO.duration * progress;
      if (state.videoCompanionAudio && Number.isFinite(VIDEO_AUDIO.duration)) VIDEO_AUDIO.currentTime = VIDEO.currentTime;
    }
  });
  $('fitVideo').addEventListener('click', () => {
    state.videoFit = !state.videoFit;
    $('videoScreen').classList.toggle('fit-mode', state.videoFit);
    $('videoHint').textContent = state.videoFit ? 'Original frame · no crop' : 'Portrait crop · phone stays upright';
  });
  AUDIO.addEventListener('play', () => { if (!state.videoOpen) setPlayIcon(true); });
  AUDIO.addEventListener('pause', () => { if (!state.videoOpen) setPlayIcon(false); });
  AUDIO.addEventListener('timeupdate', () => {
    if (!Number.isFinite(AUDIO.duration)) return;
    const fraction = AUDIO.currentTime / AUDIO.duration;
    setRange($('audioSeek'), fraction);
    $('currentTime').textContent = formatTime(AUDIO.currentTime);
    $('totalTime').textContent = formatTime(AUDIO.duration);
  });
  AUDIO.addEventListener('ended', () => {
    if (state.repeat) { AUDIO.currentTime = 0; AUDIO.play().catch(() => {}); }
    else if (state.currentIndex < state.queue.length - 1 || state.shuffle) stepTrack(1);
    else setPlayIcon(false);
  });
  AUDIO.addEventListener('error', () => { if (state.currentTrack && !state.busy) showToast('Audio stream failed. Try another Piped instance or track.', 3600); });
  VIDEO.addEventListener('play', () => { setVideoPlayIcon(true); });
  VIDEO.addEventListener('pause', () => { setVideoPlayIcon(false); VIDEO_AUDIO.pause(); });
  VIDEO.addEventListener('timeupdate', () => {
    if (!Number.isFinite(VIDEO.duration)) return;
    const fraction = VIDEO.currentTime / VIDEO.duration;
    setRange($('videoSeek'), fraction);
    $('videoCurrentTime').textContent = formatTime(VIDEO.currentTime);
    $('videoTotalTime').textContent = formatTime(VIDEO.duration);
    if (state.videoCompanionAudio && !VIDEO_AUDIO.paused && Math.abs((VIDEO_AUDIO.currentTime || 0) - VIDEO.currentTime) > 0.8) {
      try { VIDEO_AUDIO.currentTime = VIDEO.currentTime; } catch (_) { /* companion stream may not be seekable */ }
    }
  });
  VIDEO.addEventListener('ended', () => { VIDEO_AUDIO.pause(); if (state.repeat) { VIDEO.currentTime = 0; VIDEO.play().catch(() => {}); if (state.videoCompanionAudio) { VIDEO_AUDIO.currentTime = 0; VIDEO_AUDIO.play().catch(() => {}); } } else setVideoPlayIcon(false); });
  $('videoScreen').addEventListener('click', (event) => {
    if (event.target === VIDEO && VIDEO.paused) toggleVideoPlay();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.videoOpen) closeVideoMode();
    if (event.key === 'Escape' && !$('queueSheet').hidden) $('queueSheet').hidden = true;
  });
})();
