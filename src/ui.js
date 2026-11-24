import { createIcon } from './icons.js';
import { getAvailableLayouts } from './stitcher.js';
import { formatFilename } from './url.js';

const IS_ZH = typeof navigator !== 'undefined' && /^zh/i.test(navigator.language || '');

const TEXT = {
  stitch: IS_ZH ? '拼图' : 'Stitch',
  suggested: IS_ZH ? '检测到拼图' : 'Split Detected',
  partialSuggested: IS_ZH ? '局部拼图' : 'Partial Split',
  multiGroupSuffix: IS_ZH ? '组拼图' : 'Split Groups',
  singleSlide: IS_ZH ? '单图' : 'Single',
  original: IS_ZH ? '原图' : 'Orig',
  auto: IS_ZH ? '自动' : 'Auto',
  unshuffledBadge: IS_ZH ? '已自动复原顺序' : 'Auto Unshuffled',
  orderBtnTitle: IS_ZH ? '调整切片顺序' : 'Adjust tile order',
  orderHint: IS_ZH ? '点击两块交换:' : 'Swap two:',
  autoOrder: IS_ZH ? '自动排序' : 'Auto',
  resetOrder: IS_ZH ? '默认' : 'Reset',
  zoomTitle: IS_ZH ? '全屏放大预览' : 'Fullscreen preview',
  downloadTitle: IS_ZH ? '下载当前原图' : 'Download current image',
  copyTitle: IS_ZH ? '复制当前图片到剪贴板' : 'Copy current image to clipboard',
  settingsTitle: IS_ZH ? '设置' : 'Settings',
  prevItemTitle: IS_ZH ? '上一项' : 'Previous item',
  nextItemTitle: IS_ZH ? '下一项' : 'Next item',
  loading: IS_ZH ? '拼合中...' : 'Stitching...',
  lbFit: IS_ZH ? '适应窗口' : 'Fit',
  lbActual: '1:1',
  lbDownload: IS_ZH ? '下载原图' : 'Download',
  lbCopy: IS_ZH ? '复制图片' : 'Copy',
  lbClose: IS_ZH ? '关闭' : 'Close',
  lbFooter: IS_ZH
    ? '滚轮缩放 · 拖拽平移 · 单击切换适应/原尺寸 · 快捷键: D 下载 / C 复制 / 0 适应 / ESC 关闭'
    : 'Wheel to zoom · Drag to pan · Click toggles Fit/1:1 · Keys: D download / C copy / 0 fit / ESC close',
  lbFooterMulti: IS_ZH
    ? '滚轮缩放 · 拖拽平移 · ←/→ 切换画廊 · 单击适应/1:1 · D 下载 / C 复制 / ESC 关闭'
    : 'Wheel zoom · Drag pan · ←/→ switch item · Click Fit/1:1 · D download / C copy / ESC close',
  settingsHeading: IS_ZH ? 'X Art Stitcher 设置' : 'X Art Stitcher Settings',
  settingsSubtitle: IS_ZH
    ? '拼图检测、GIF 转存与导出偏好设置'
    : 'Stitching, GIF conversion & export preferences',
  sectionStitching: IS_ZH ? '画作拼图' : 'Artwork Stitching',
  sectionGifVideo: IS_ZH ? 'GIF 与视频导出' : 'GIF & Video Export',
  sectionOutput: IS_ZH ? '输出与高级设置' : 'Output & Advanced',
  optAutoDetect: IS_ZH ? '自动识别多图拼图' : 'Auto-detect split artworks',
  optAutoDetectDesc: IS_ZH
    ? '进入视野时分析边缘像素连续性，判断是否为拆分画作'
    : 'Analyze edge continuity when multi-image tweets enter viewport',
  optAutoStitch: IS_ZH ? '识别命中后自动拼合显示' : 'Auto-stitch detected artworks',
  optAutoStitchDesc: IS_ZH
    ? '关闭后仅高亮提示按钮，由你手动点击拼合'
    : 'When disabled, only highlights the stitch button without replacing',
  optAutoUnshuffle: IS_ZH ? '自动复原乱序/防 AI 切片' : 'Auto-unshuffle scrambled slices',
  optAutoUnshuffleDesc: IS_ZH
    ? '根据相邻边相似度尝试还原被打乱顺序的切片'
    : 'Search tile permutations to restore scrambled multi-image slices',
  optSensitivity: IS_ZH ? '自动识别灵敏度' : 'Detection sensitivity',
  optSensitivityDesc: IS_ZH
    ? '控制边缘拼接判定阈值与抗压缩容差'
    : 'Controls seam-matching strictness and compression tolerance',
  sensStrict: IS_ZH ? '严格' : 'Strict',
  sensNormal: IS_ZH ? '标准' : 'Normal',
  sensLoose: IS_ZH ? '宽松' : 'Loose',
  optEnableGifTools: IS_ZH ? '启用 GIF / 视频导出工具' : 'Enable GIF & video export tools',
  optEnableGifToolsDesc: IS_ZH
    ? '在 X 的 GIF 与视频播放器右上角显示转存 GIF / 下载 MP4 悬浮控制条'
    : 'Show floating GIF conversion and MP4 download controls on X videos',
  optAutoDetectGifVideos: IS_ZH ? '自动识别类 GIF 无声短视频' : 'Auto-detect GIF-like silent videos',
  optAutoDetectGifVideosDesc: IS_ZH
    ? '自动探测短时无音轨视频的 MP4 头信息并高亮提示转存为 GIF'
    : 'Probe short silent MP4 headers and highlight them for instant GIF export',
  optShowOnRegularVideos: IS_ZH ? '在普通视频上显示折叠按钮' : 'Show compact button on regular videos',
  optShowOnRegularVideosDesc: IS_ZH
    ? '为包含音轨或较长的普通视频提供轻量化 GIF / MP4 导出入口'
    : 'Keep a subtle collapsed GIF / MP4 pill on regular videos',
  optGifFps: IS_ZH ? 'GIF 导出帧率' : 'GIF frame rate',
  optGifFpsDesc: IS_ZH
    ? '原生 GIF 会尽量保留原有帧节奏，高帧率视频将平滑降采样'
    : 'Native GIFs preserve cadence when possible; higher FPS clips resample smoothly',
  optGifMaxWidth: IS_ZH ? 'GIF 最大宽度' : 'GIF max width',
  optGifMaxWidthDesc: IS_ZH
    ? '超过该宽度的视频将按比例缩小，以平衡清晰度与文件体积'
    : 'Downscales wider videos proportionally to balance sharpness and file size',
  optWidthOrig: IS_ZH ? '原尺寸' : 'Orig',
  optGifQuality: IS_ZH ? 'GIF 编码质量' : 'GIF encoding quality',
  optGifQualityDesc: IS_ZH
    ? '“均衡”使用有序抖动与帧间差分裁剪；“高画质”每帧独立生成调色板'
    : 'Balanced uses ordered dithering & delta cropping; High builds per-frame palettes',
  qualFast: IS_ZH ? '极速' : 'Fast',
  qualBalanced: IS_ZH ? '均衡' : 'Balanced',
  qualHigh: IS_ZH ? '高画质' : 'High',
  optGifMaxDuration: IS_ZH ? 'GIF 最大截取时长' : 'Max GIF clip duration',
  optGifMaxDurationDesc: IS_ZH
    ? '超长视频将截取前若干秒进行转码，防止浏览器内存占用过高'
    : 'Clips longer than this limit export only the opening segment',
  optFormat: IS_ZH ? '图片下载格式' : 'Image download format',
  optFormatDesc: IS_ZH
    ? '适用于拼合画作及单图下载（GIF 导出固定为 .gif）'
    : 'Applies to stitched and standalone images (GIF export always outputs .gif)',
  optTemplate: IS_ZH ? '下载文件名模板' : 'Filename template',
  optTemplateDesc: IS_ZH
    ? '可用占位符: {handle}, {tweetId}, {layout}'
    : 'Placeholders: {handle}, {tweetId}, {layout}',
  previewPrefix: IS_ZH ? '预览: ' : 'Preview: ',
  optDebug: IS_ZH ? '控制台输出调试日志' : 'Console debug logging',
  optDebugDesc: IS_ZH
    ? '在浏览器开发者工具中记录检测分数与视频探测信息'
    : 'Print detection scores and MP4 probe metadata to console',
  save: IS_ZH ? '保存' : 'Save',
  cancel: IS_ZH ? '取消' : 'Cancel',
  gifLabel: 'GIF',
  mp4Label: 'MP4',
  exportGifLabel: IS_ZH ? '导出 GIF' : 'Export GIF',
  saveGifTitle: IS_ZH ? '转码并下载 .gif 动图' : 'Convert and download as .gif',
  saveGifLikeTitle: IS_ZH
    ? '检测到无声类 GIF 短视频 — 点击转码下载 .gif'
    : 'Silent GIF-like video detected — click to save .gif',
  expandVideoToolsTitle: IS_ZH ? '展开 GIF / MP4 导出选项' : 'Expand GIF / MP4 export controls',
  collapseVideoToolsTitle: IS_ZH ? '收起' : 'Collapse',
  downloadMp4Title: IS_ZH ? '下载原始 .mp4 视频' : 'Download raw .mp4 video',
  cancelGifTitle: IS_ZH ? '取消当前任务' : 'Cancel current task',
  stageFetch: IS_ZH ? '获取视频中...' : 'Fetching MP4...',
  stageExtract: IS_ZH ? '抽帧' : 'Extracting',
  stageEncode: IS_ZH ? '编码 GIF' : 'Encoding GIF',
  gifCancelled: IS_ZH ? '已取消 GIF 导出' : 'GIF export cancelled',
};

export function t(key) {
  return TEXT[key] || key;
}

export function getLayoutLabel(layout) {
  switch (layout) {
    case 'grid-2x2':
      return '2×2';
    case 'horizontal':
      return IS_ZH ? '横拼' : 'Horiz';
    case 'vertical':
      return IS_ZH ? '竖拼' : 'Vert';
    case '3-left-tall':
      return IS_ZH ? '左1右2' : '1L+2R';
    case '3-right-tall':
      return IS_ZH ? '左2右1' : '2L+1R';
    case '3-top-wide':
      return IS_ZH ? '上1下2' : '1T+2B';
    case '3-bottom-wide':
      return IS_ZH ? '上2下1' : '2T+1B';
    default:
      return layout.replace(/^grid-/, '');
  }
}

export function formatIndexRange(indices) {
  if (!indices || indices.length === 0) return '';
  const sorted = indices.slice().sort((a, b) => a - b);
  let contiguous = true;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1] + 1) {
      contiguous = false;
      break;
    }
  }
  if (contiguous && sorted.length > 1) {
    return `${sorted[0] + 1}–${sorted[sorted.length - 1] + 1}`;
  }
  return sorted.map((i) => i + 1).join(',');
}

let toastTimer = null;
let toastEl = null;

export function showToast(message, isError = false) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'xas-toast';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = message;
  toastEl.classList.toggle('xas-toast-error', Boolean(isError));
  toastEl.classList.add('xas-toast-visible');

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl?.classList.remove('xas-toast-visible');
  }, 2400);
}

function stopBubble(event) {
  event.preventDefault();
  event.stopPropagation();
}

function appendIconLabel(el, iconName, label, iconSize = 15) {
  if (iconName) el.appendChild(createIcon(iconName, iconSize));
  if (label) {
    const text = document.createElement('span');
    text.textContent = label;
    el.appendChild(text);
  }
}

function makeIconButton({ icon, title, size = 16, active = false, onClick }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = active ? 'xas-btn xas-btn-icon xas-btn-active' : 'xas-btn xas-btn-icon';
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.appendChild(createIcon(icon, size));
  btn.addEventListener('click', (e) => {
    stopBubble(e);
    onClick();
  });
  return btn;
}

export function openLightbox({
  items,
  activeIndex = 0,
  onSelectIndex,
  onDownload,
  onCopy,
}) {
  if (!Array.isArray(items) || items.length === 0) return;
  const existing = document.querySelector('.xas-lightbox');
  if (existing) existing.remove();

  const slideList = items.map((item) => ({ ...item, width: item.width || 0, height: item.height || 0 }));
  let currentIdx = Math.max(0, Math.min(slideList.length - 1, activeIndex));
  const isMulti = slideList.length > 1;

  const overlay = document.createElement('div');
  overlay.className = 'xas-lightbox';

  const header = document.createElement('div');
  header.className = 'xas-lb-header';

  const titleEl = document.createElement('div');
  titleEl.className = 'xas-lb-title';

  const actions = document.createElement('div');
  actions.className = 'xas-lb-actions';

  const makeBtn = (label, primary, handler, iconName = null) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = primary ? 'xas-lb-btn xas-lb-primary' : 'xas-lb-btn';
    appendIconLabel(btn, iconName, label, 16);
    btn.addEventListener('click', (e) => {
      stopBubble(e);
      handler();
    });
    return btn;
  };

  const viewport = document.createElement('div');
  viewport.className = 'xas-lb-viewport';

  const img = document.createElement('img');
  img.className = 'xas-lb-img';
  viewport.appendChild(img);

  let prevBtn = null;
  let nextBtn = null;
  if (isMulti) {
    prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'xas-lb-nav xas-lb-prev';
    prevBtn.title = t('prevItemTitle');
    prevBtn.setAttribute('aria-label', t('prevItemTitle'));
    prevBtn.appendChild(createIcon('chevron_left', 24));
    prevBtn.addEventListener('click', (e) => {
      stopBubble(e);
      stepSlide(-1);
    });

    nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'xas-lb-nav xas-lb-next';
    nextBtn.title = t('nextItemTitle');
    nextBtn.setAttribute('aria-label', t('nextItemTitle'));
    nextBtn.appendChild(createIcon('chevron_right', 24));
    nextBtn.addEventListener('click', (e) => {
      stopBubble(e);
      stepSlide(1);
    });

    viewport.appendChild(prevBtn);
    viewport.appendChild(nextBtn);
  }

  const footer = document.createElement('div');
  footer.className = 'xas-lb-footer';
  footer.textContent = isMulti ? t('lbFooterMulti') : t('lbFooter');

  let curW = 1;
  let curH = 1;
  let scale = 1;
  let fitScale = 1;
  let tx = 0;
  let ty = 0;
  let isDragging = false;
  let dragMoved = false;
  let startX = 0;
  let startY = 0;
  let origTx = 0;
  let origTy = 0;

  const applyTransform = () => {
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  };

  const computeFitScale = () => {
    const rect = viewport.getBoundingClientRect();
    const pad = 24;
    const availW = Math.max(100, rect.width - pad * 2);
    const availH = Math.max(100, rect.height - pad * 2);
    const w = Math.max(1, curW || img.naturalWidth || 1);
    const h = Math.max(1, curH || img.naturalHeight || 1);
    return Math.min(1, availW / w, availH / h);
  };

  const setFit = () => {
    fitScale = computeFitScale();
    scale = fitScale;
    tx = 0;
    ty = 0;
    applyTransform();
  };

  const setActual = () => {
    fitScale = computeFitScale();
    scale = 1;
    tx = 0;
    ty = 0;
    applyTransform();
  };

  const updateTitle = () => {
    const item = slideList[currentIdx];
    const parts = [item.title];
    if (curW > 0 && curH > 0) parts.push(`${curW}×${curH}`);
    if (isMulti) parts.push(`${currentIdx + 1} / ${slideList.length}`);
    titleEl.textContent = parts.join(' · ');
  };

  const loadSlide = (idx) => {
    currentIdx = idx;
    const item = slideList[currentIdx];
    curW = item.width || 0;
    curH = item.height || 0;
    img.src = item.url;
    img.alt = item.title;
    updateTitle();
    if (prevBtn) prevBtn.style.display = currentIdx > 0 ? 'inline-flex' : 'none';
    if (nextBtn) nextBtn.style.display = currentIdx + 1 < slideList.length ? 'inline-flex' : 'none';
    if (curW > 0 && curH > 0) {
      requestAnimationFrame(setFit);
    }
  };

  img.addEventListener('load', () => {
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      if (!curW || !curH) {
        curW = img.naturalWidth;
        curH = img.naturalHeight;
        slideList[currentIdx].width = curW;
        slideList[currentIdx].height = curH;
        updateTitle();
      }
      setFit();
    }
  });

  const stepSlide = (delta) => {
    const nextIdx = currentIdx + delta;
    if (nextIdx < 0 || nextIdx >= slideList.length) return;
    loadSlide(nextIdx);
    onSelectIndex?.(nextIdx);
  };

  const close = () => {
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('resize', onResize);
    overlay.remove();
  };

  const onResize = () => {
    const wasFit = Math.abs(scale - fitScale) < 0.01;
    fitScale = computeFitScale();
    if (wasFit) {
      scale = fitScale;
      tx = 0;
      ty = 0;
      applyTransform();
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      stopBubble(e);
      close();
    } else if (isMulti && e.key === 'ArrowLeft') {
      stopBubble(e);
      stepSlide(-1);
    } else if (isMulti && e.key === 'ArrowRight') {
      stopBubble(e);
      stepSlide(1);
    } else if (e.key === '0') {
      stopBubble(e);
      setFit();
    } else if (e.key === '1') {
      stopBubble(e);
      setActual();
    } else if (e.key === '+' || e.key === '=') {
      stopBubble(e);
      scale = Math.min(4, scale * 1.25);
      applyTransform();
    } else if (e.key === '-') {
      stopBubble(e);
      scale = Math.max(0.1, scale / 1.25);
      applyTransform();
    } else if (e.key.toLowerCase() === 'd') {
      stopBubble(e);
      onDownload(currentIdx);
    } else if (e.key.toLowerCase() === 'c') {
      stopBubble(e);
      onCopy(currentIdx);
    }
  };

  viewport.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.16 : 1 / 1.16;
      scale = Math.max(0.1, Math.min(5, scale * factor));
      applyTransform();
    },
    { passive: false },
  );

  viewport.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.xas-lb-nav')) return;
    isDragging = true;
    dragMoved = false;
    startX = e.clientX;
    startY = e.clientY;
    origTx = tx;
    origTy = ty;
    viewport.classList.add('xas-dragging');
    viewport.setPointerCapture?.(e.pointerId);
  });

  viewport.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragMoved = true;
    tx = origTx + dx;
    ty = origTy + dy;
    applyTransform();
  });

  const endDrag = () => {
    isDragging = false;
    viewport.classList.remove('xas-dragging');
  };
  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);

  viewport.addEventListener('click', (e) => {
    if (dragMoved) return;
    if (e.target === viewport) {
      close();
      return;
    }
    if (e.target === img) {
      if (Math.abs(scale - fitScale) < 0.02) {
        setActual();
      } else {
        setFit();
      }
    }
  });

  actions.appendChild(makeBtn(t('lbFit'), false, setFit, 'fit_screen'));
  actions.appendChild(makeBtn(t('lbActual'), false, setActual));
  actions.appendChild(makeBtn(t('lbCopy'), false, () => onCopy(currentIdx), 'content_copy'));
  actions.appendChild(makeBtn(t('lbDownload'), true, () => onDownload(currentIdx), 'download'));
  actions.appendChild(makeBtn(t('lbClose'), false, close, 'close'));

  header.appendChild(titleEl);
  header.appendChild(actions);
  overlay.appendChild(header);
  overlay.appendChild(viewport);
  overlay.appendChild(footer);

  document.body.appendChild(overlay);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('resize', onResize);

  loadSlide(currentIdx);
}

function isPageLightTheme() {
  try {
    for (const el of [document.body, document.documentElement]) {
      if (!el) continue;
      const bg = window.getComputedStyle(el).backgroundColor;
      const match = bg && bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/i);
      if (!match) continue;
      const alpha = match[4] !== undefined ? Number(match[4]) : 1;
      if (alpha === 0) continue;
      const lum = (0.299 * Number(match[1]) + 0.587 * Number(match[2]) + 0.114 * Number(match[3])) / 255;
      return lum > 0.5;
    }
  } catch (_) {
    // Default to dark tonal theme if computed style is unavailable.
  }
  return false;
}

let activeModalCleanup = null;

export function openSettingsModal(currentConfig, onSave) {
  if (activeModalCleanup) {
    activeModalCleanup();
  } else {
    const existing = document.querySelector('.xas-modal-backdrop');
    if (existing) existing.remove();
  }

  const backdrop = document.createElement('div');
  backdrop.className = isPageLightTheme()
    ? 'xas-modal-backdrop xas-theme-light'
    : 'xas-modal-backdrop';

  const modal = document.createElement('div');
  modal.className = 'xas-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'xas-settings-title');

  const closeModal = () => {
    window.removeEventListener('keydown', onKeyDown, true);
    backdrop.remove();
    if (activeModalCleanup === closeModal) activeModalCleanup = null;
  };
  activeModalCleanup = closeModal;

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      stopBubble(e);
      closeModal();
    }
  };

  const head = document.createElement('div');
  head.className = 'xas-modal-head';

  const headIcon = document.createElement('div');
  headIcon.className = 'xas-m3-head-icon';
  headIcon.appendChild(createIcon('tune', 20));

  const headText = document.createElement('div');
  headText.className = 'xas-m3-head-text';
  const heading = document.createElement('h3');
  heading.id = 'xas-settings-title';
  heading.textContent = t('settingsHeading');
  const subtitle = document.createElement('div');
  subtitle.className = 'xas-m3-head-subtitle';
  subtitle.textContent = t('settingsSubtitle');
  headText.appendChild(heading);
  headText.appendChild(subtitle);

  const closeX = document.createElement('button');
  closeX.type = 'button';
  closeX.className = 'xas-m3-icon-btn';
  closeX.title = t('lbClose');
  closeX.setAttribute('aria-label', t('lbClose'));
  closeX.appendChild(createIcon('close', 20));
  closeX.addEventListener('click', closeModal);

  head.appendChild(headIcon);
  head.appendChild(headText);
  head.appendChild(closeX);

  const body = document.createElement('div');
  body.className = 'xas-modal-body';

  const draft = { ...currentConfig };
  const previewListeners = [];

  const createSection = (titleText) => {
    const section = document.createElement('div');
    section.className = 'xas-m3-section';
    const titleEl = document.createElement('div');
    titleEl.className = 'xas-m3-section-title';
    titleEl.textContent = titleText;
    const card = document.createElement('div');
    card.className = 'xas-m3-card';
    section.appendChild(titleEl);
    section.appendChild(card);
    body.appendChild(section);
    return card;
  };

  const addSwitchRow = (card, label, desc, key) => {
    const row = document.createElement('label');
    row.className = 'xas-m3-row';

    const copy = document.createElement('div');
    copy.className = 'xas-m3-row-copy';
    const titleDiv = document.createElement('div');
    titleDiv.className = 'xas-m3-row-title';
    titleDiv.textContent = label;
    copy.appendChild(titleDiv);
    if (desc) {
      const descDiv = document.createElement('div');
      descDiv.className = 'xas-m3-row-desc';
      descDiv.textContent = desc;
      copy.appendChild(descDiv);
    }

    const switchWrap = document.createElement('span');
    switchWrap.className = 'xas-m3-switch';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'xas-m3-switch-input';
    input.checked = Boolean(draft[key]);
    input.setAttribute('role', 'switch');
    input.setAttribute('aria-checked', String(input.checked));

    const track = document.createElement('span');
    track.className = 'xas-m3-switch-track';
    const thumb = document.createElement('span');
    thumb.className = 'xas-m3-switch-thumb';
    thumb.appendChild(createIcon('check', 14));
    track.appendChild(thumb);

    input.addEventListener('change', () => {
      draft[key] = input.checked;
      input.setAttribute('aria-checked', String(input.checked));
    });

    switchWrap.appendChild(input);
    switchWrap.appendChild(track);
    row.appendChild(copy);
    row.appendChild(switchWrap);
    card.appendChild(row);
  };

  const addSegmentedRow = (card, label, desc, key, options) => {
    const row = document.createElement('div');
    row.className = 'xas-m3-row-stack';

    const copy = document.createElement('div');
    copy.className = 'xas-m3-row-copy';
    const titleDiv = document.createElement('div');
    titleDiv.className = 'xas-m3-row-title';
    titleDiv.textContent = label;
    copy.appendChild(titleDiv);
    if (desc) {
      const descDiv = document.createElement('div');
      descDiv.className = 'xas-m3-row-desc';
      descDiv.textContent = desc;
      copy.appendChild(descDiv);
    }

    const group = document.createElement('div');
    group.className = 'xas-m3-segmented';
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', label);

    const buttons = [];
    const syncActive = () => {
      for (const item of buttons) {
        const isSelected = draft[key] === item.value;
        item.btn.classList.toggle('xas-m3-seg-active', isSelected);
        item.btn.setAttribute('aria-checked', String(isSelected));
        item.checkEl.style.display = isSelected ? 'block' : 'none';
      }
    };

    for (const opt of options) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'xas-m3-seg-btn';
      btn.setAttribute('role', 'radio');

      const checkEl = createIcon('check', 14);
      const textSpan = document.createElement('span');
      textSpan.textContent = opt.label;
      btn.appendChild(checkEl);
      btn.appendChild(textSpan);

      btn.addEventListener('click', () => {
        draft[key] = opt.value;
        syncActive();
        for (const listener of previewListeners) listener();
      });

      buttons.push({ btn, checkEl, value: opt.value });
      group.appendChild(btn);
    }

    syncActive();
    row.appendChild(copy);
    row.appendChild(group);
    card.appendChild(row);
  };

  const addTextFieldRow = (card, label, desc, key, previewFormatter) => {
    const row = document.createElement('label');
    row.className = 'xas-m3-row-stack';

    const copy = document.createElement('div');
    copy.className = 'xas-m3-row-copy';
    const titleDiv = document.createElement('div');
    titleDiv.className = 'xas-m3-row-title';
    titleDiv.textContent = label;
    copy.appendChild(titleDiv);
    if (desc) {
      const descDiv = document.createElement('div');
      descDiv.className = 'xas-m3-row-desc';
      descDiv.textContent = desc;
      copy.appendChild(descDiv);
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'xas-m3-textfield';
    input.value = draft[key] || '';

    const previewEl = document.createElement('div');
    previewEl.className = 'xas-m3-preview-line';
    const updatePreview = () => {
      if (previewFormatter) {
        previewEl.textContent = previewFormatter(draft);
      }
    };
    updatePreview();
    previewListeners.push(updatePreview);

    input.addEventListener('input', () => {
      draft[key] = input.value;
      updatePreview();
    });

    row.appendChild(copy);
    row.appendChild(input);
    if (previewFormatter) row.appendChild(previewEl);
    card.appendChild(row);
  };

  const stitchingCard = createSection(t('sectionStitching'));
  addSwitchRow(stitchingCard, t('optAutoDetect'), t('optAutoDetectDesc'), 'autoDetect');
  addSwitchRow(stitchingCard, t('optAutoStitch'), t('optAutoStitchDesc'), 'autoStitch');
  addSwitchRow(stitchingCard, t('optAutoUnshuffle'), t('optAutoUnshuffleDesc'), 'autoUnshuffle');
  addSegmentedRow(stitchingCard, t('optSensitivity'), t('optSensitivityDesc'), 'sensitivity', [
    { value: 'strict', label: t('sensStrict') },
    { value: 'normal', label: t('sensNormal') },
    { value: 'loose', label: t('sensLoose') },
  ]);

  const gifCard = createSection(t('sectionGifVideo'));
  addSwitchRow(gifCard, t('optEnableGifTools'), t('optEnableGifToolsDesc'), 'enableGifTools');
  addSwitchRow(
    gifCard,
    t('optAutoDetectGifVideos'),
    t('optAutoDetectGifVideosDesc'),
    'autoDetectGifVideos',
  );
  addSwitchRow(
    gifCard,
    t('optShowOnRegularVideos'),
    t('optShowOnRegularVideosDesc'),
    'showOnRegularVideos',
  );
  addSegmentedRow(gifCard, t('optGifFps'), t('optGifFpsDesc'), 'gifFps', [
    { value: 10, label: '10 fps' },
    { value: 15, label: '15 fps' },
    { value: 20, label: '20 fps' },
    { value: 25, label: '25 fps' },
  ]);
  addSegmentedRow(gifCard, t('optGifMaxWidth'), t('optGifMaxWidthDesc'), 'gifMaxWidth', [
    { value: 480, label: '480px' },
    { value: 540, label: '540px' },
    { value: 720, label: '720px' },
    { value: 0, label: t('optWidthOrig') },
  ]);
  addSegmentedRow(gifCard, t('optGifQuality'), t('optGifQualityDesc'), 'gifQuality', [
    { value: 'fast', label: t('qualFast') },
    { value: 'balanced', label: t('qualBalanced') },
    { value: 'high', label: t('qualHigh') },
  ]);
  addSegmentedRow(gifCard, t('optGifMaxDuration'), t('optGifMaxDurationDesc'), 'gifMaxDuration', [
    { value: 8, label: '8s' },
    { value: 15, label: '15s' },
    { value: 25, label: '25s' },
  ]);

  const outputCard = createSection(t('sectionOutput'));
  addSegmentedRow(outputCard, t('optFormat'), t('optFormatDesc'), 'downloadFormat', [
    { value: 'png', label: 'PNG' },
    { value: 'jpeg', label: 'JPEG (95%)' },
    { value: 'webp', label: 'WebP (95%)' },
  ]);
  addTextFieldRow(
    outputCard,
    t('optTemplate'),
    t('optTemplateDesc'),
    'filenameTemplate',
    (d) =>
      `${t('previewPrefix')}${formatFilename(d.filenameTemplate, {
        handle: 'artist',
        tweetId: '189000123',
        layout: '2x2',
        ext: d.downloadFormat || 'png',
      })}`,
  );
  addSwitchRow(outputCard, t('optDebug'), t('optDebugDesc'), 'debug');

  const foot = document.createElement('div');
  foot.className = 'xas-modal-foot';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'xas-m3-text-btn';
  cancelBtn.textContent = t('cancel');
  cancelBtn.addEventListener('click', closeModal);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'xas-m3-filled-btn';
  saveBtn.appendChild(createIcon('check', 16));
  const saveLabel = document.createElement('span');
  saveLabel.textContent = t('save');
  saveBtn.appendChild(saveLabel);
  saveBtn.addEventListener('click', () => {
    onSave(draft);
    closeModal();
  });

  foot.appendChild(cancelBtn);
  foot.appendChild(saveBtn);

  modal.appendChild(head);
  modal.appendChild(body);
  modal.appendChild(foot);
  backdrop.appendChild(modal);

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeModal();
  });

  window.addEventListener('keydown', onKeyDown, true);
  document.body.appendChild(backdrop);
}

/**
 * Manage the injected UI controls and stitched / mixed-gallery preview stage
 * for a single tweet gallery.
 */
export function createGalleryUI(gallery, callbacks) {
  const { container, urls } = gallery;
  container.classList.add('xas-root');

  const toolbar = document.createElement('div');
  toolbar.className = 'xas-injected xas-toolbar';
  toolbar.addEventListener('click', stopBubble);

  const stage = document.createElement('div');
  stage.className = 'xas-injected xas-stage';
  stage.style.display = 'none';

  const stageMedia = document.createElement('div');
  stageMedia.className = 'xas-stage-media';

  const previewImg = document.createElement('img');
  previewImg.className = 'xas-preview';
  previewImg.addEventListener('click', (e) => {
    stopBubble(e);
    callbacks.onOpenLightbox();
  });

  const prevNavBtn = document.createElement('button');
  prevNavBtn.type = 'button';
  prevNavBtn.className = 'xas-nav-btn xas-nav-prev';
  prevNavBtn.title = t('prevItemTitle');
  prevNavBtn.setAttribute('aria-label', t('prevItemTitle'));
  prevNavBtn.style.display = 'none';
  prevNavBtn.appendChild(createIcon('chevron_left', 22));
  prevNavBtn.addEventListener('click', (e) => {
    stopBubble(e);
    if (state.activeIndex > 0) {
      callbacks.onSelectGalleryItem?.(state.activeIndex - 1);
    }
  });

  const nextNavBtn = document.createElement('button');
  nextNavBtn.type = 'button';
  nextNavBtn.className = 'xas-nav-btn xas-nav-next';
  nextNavBtn.title = t('nextItemTitle');
  nextNavBtn.setAttribute('aria-label', t('nextItemTitle'));
  nextNavBtn.style.display = 'none';
  nextNavBtn.appendChild(createIcon('chevron_right', 22));
  nextNavBtn.addEventListener('click', (e) => {
    stopBubble(e);
    if (state.activeIndex + 1 < state.items.length) {
      callbacks.onSelectGalleryItem?.(state.activeIndex + 1);
    }
  });

  const metaBadge = document.createElement('div');
  metaBadge.className = 'xas-meta-badge';

  stageMedia.appendChild(previewImg);
  stageMedia.appendChild(prevNavBtn);
  stageMedia.appendChild(nextNavBtn);
  stageMedia.appendChild(metaBadge);

  const filmstrip = document.createElement('div');
  filmstrip.className = 'xas-gallery-strip';
  filmstrip.style.display = 'none';
  filmstrip.addEventListener('click', stopBubble);
  filmstrip.addEventListener(
    'wheel',
    (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && filmstrip.scrollWidth > filmstrip.clientWidth) {
        e.preventDefault();
        filmstrip.scrollLeft += e.deltaY;
      }
    },
    { passive: false },
  );

  stage.appendChild(stageMedia);
  stage.appendChild(filmstrip);

  container.appendChild(stage);
  container.appendChild(toolbar);

  const state = {
    active: false,
    busy: false,
    expanded: false,
    showOrderEditor: false,
    selectedSlot: null,
    items: [], // [{ type: 'stitched', ... } | { type: 'single', ... }]
    activeIndex: 0,
    suggested: null, // full or partial suggestion
  };

  const fullLayouts = getAvailableLayouts(urls.length);

  const getActiveItem = () => (state.active ? state.items[state.activeIndex] || null : null);

  const formatSuggestionLabel = (s) => {
    if (s.isPartial) {
      if (s.stitchedCount > 1) {
        return `${s.stitchedCount} ${t('multiGroupSuffix')}`;
      }
      const range = formatIndexRange(s.primaryGroup.indices);
      return `${t('partialSuggested')} #${range} (${getLayoutLabel(s.primaryGroup.layout)})`;
    }
    return `${t('suggested')} (${getLayoutLabel(s.layout)})`;
  };

  const updateStageView = () => {
    const item = getActiveItem();
    if (!item) return;

    const isMulti = state.items.length > 1;
    previewImg.src = item.type === 'stitched' ? item.objectUrl : item.url;

    prevNavBtn.style.display = isMulti && state.activeIndex > 0 ? 'inline-flex' : 'none';
    nextNavBtn.style.display = isMulti && state.activeIndex + 1 < state.items.length ? 'inline-flex' : 'none';

    metaBadge.textContent = '';
    const parts = [];
    if (item.type === 'stitched') {
      if (item.wasUnshuffled) {
        metaBadge.appendChild(createIcon('auto_awesome', 14));
        parts.push(t('unshuffledBadge'));
      }
      if (isMulti) parts.push(`#${formatIndexRange(item.indices)}`);
      parts.push(getLayoutLabel(item.layout));
      if (item.width > 0 && item.height > 0) parts.push(`${item.width}×${item.height}`);
    } else {
      parts.push(`#${item.index + 1}`);
      parts.push(t('singleSlide'));
      if (item.width > 0 && item.height > 0) parts.push(`${item.width}×${item.height}`);
    }
    if (isMulti) {
      parts.push(`${state.activeIndex + 1} / ${state.items.length}`);
    }
    const metaText = document.createElement('span');
    metaText.textContent = parts.join(' · ');
    metaBadge.appendChild(metaText);

    if (!isMulti) {
      filmstrip.style.display = 'none';
      filmstrip.textContent = '';
      return;
    }

    filmstrip.style.display = 'flex';
    filmstrip.textContent = '';
    state.items.forEach((entry, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isSelected = idx === state.activeIndex;
      btn.className =
        'xas-thumb' +
        (entry.type === 'stitched' ? ' xas-thumb-stitched' : '') +
        (isSelected ? ' xas-thumb-active' : '');
      const label =
        entry.type === 'stitched'
          ? `${t('stitch')} #${formatIndexRange(entry.indices)} (${getLayoutLabel(entry.layout)})`
          : `#${entry.index + 1}`;
      btn.title = label;
      btn.setAttribute('aria-label', label);

      const thumbImg = document.createElement('img');
      thumbImg.className = 'xas-thumb-img';
      thumbImg.src = entry.type === 'stitched' ? entry.objectUrl : entry.thumbUrl;
      thumbImg.alt = label;
      btn.appendChild(thumbImg);

      const tag = document.createElement('span');
      tag.className = 'xas-thumb-tag';
      if (entry.type === 'stitched') {
        tag.appendChild(createIcon('grid_view', 11));
        const tagText = document.createElement('span');
        tagText.textContent = formatIndexRange(entry.indices);
        tag.appendChild(tagText);
      } else {
        tag.textContent = String(entry.index + 1);
      }
      btn.appendChild(tag);

      btn.addEventListener('click', (e) => {
        stopBubble(e);
        if (idx !== state.activeIndex) {
          callbacks.onSelectGalleryItem?.(idx);
        }
      });

      filmstrip.appendChild(btn);
      if (isSelected) {
        btn.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      }
    });
  };

  const renderToolbar = () => {
    toolbar.textContent = '';
    toolbar.classList.toggle('xas-expanded', state.expanded || state.active);

    const pill = document.createElement('div');
    pill.className = 'xas-pill';

    if (state.busy) {
      const spinner = document.createElement('span');
      spinner.className = 'xas-spinner';
      const label = document.createElement('span');
      label.style.padding = '4px 6px';
      label.textContent = t('loading');
      pill.appendChild(spinner);
      pill.appendChild(label);
      toolbar.appendChild(pill);
      return;
    }

    if (!state.active && !state.expanded) {
      pill.classList.add(state.suggested ? 'xas-suggested' : 'xas-collapsed');
      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = state.suggested ? 'xas-btn xas-btn-accent' : 'xas-btn';
      if (state.suggested) {
        appendIconLabel(trigger, 'auto_awesome', formatSuggestionLabel(state.suggested), 15);
      } else {
        appendIconLabel(trigger, 'grid_view', t('stitch'), 15);
      }
      trigger.addEventListener('click', (e) => {
        stopBubble(e);
        if (state.suggested) {
          if (state.suggested.isPartial) {
            callbacks.onOpenMixedGallery?.(state.suggested.groups);
          } else {
            callbacks.onSelectLayout(
              state.suggested.layout,
              state.suggested.order,
              state.suggested.wasUnshuffled,
            );
          }
        } else {
          state.expanded = true;
          renderToolbar();
        }
      });
      pill.appendChild(trigger);
      toolbar.appendChild(pill);
      return;
    }

    const activeItem = getActiveItem();
    const isStitchedItem = Boolean(activeItem && activeItem.type === 'stitched');

    // Restore original view button (or collapse if not active)
    const origBtn = document.createElement('button');
    origBtn.type = 'button';
    origBtn.className = state.active ? 'xas-btn' : 'xas-btn xas-btn-active';
    origBtn.textContent = t('original');
    origBtn.addEventListener('click', (e) => {
      stopBubble(e);
      state.expanded = false;
      state.showOrderEditor = false;
      state.selectedSlot = null;
      if (state.active) {
        callbacks.onRestoreOriginal();
      } else {
        renderToolbar();
      }
    });
    pill.appendChild(origBtn);

    if (!state.active) {
      for (const layout of fullLayouts) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'xas-btn';
        btn.textContent = getLayoutLabel(layout);
        btn.addEventListener('click', (e) => {
          stopBubble(e);
          callbacks.onSelectLayout(layout, null, false);
        });
        pill.appendChild(btn);
      }

      const autoBtn = document.createElement('button');
      autoBtn.type = 'button';
      autoBtn.className = 'xas-btn xas-btn-accent';
      appendIconLabel(autoBtn, 'auto_awesome', t('auto'), 15);
      autoBtn.addEventListener('click', (e) => {
        stopBubble(e);
        callbacks.onAutoSolve();
      });
      pill.appendChild(autoBtn);
    } else {
      if (isStitchedItem) {
        const groupLayouts = getAvailableLayouts(activeItem.indices.length);
        for (const layout of groupLayouts) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = activeItem.layout === layout ? 'xas-btn xas-btn-active' : 'xas-btn';
          btn.textContent = getLayoutLabel(layout);
          btn.addEventListener('click', (e) => {
            stopBubble(e);
            callbacks.onSelectLayout(layout, null, false);
          });
          pill.appendChild(btn);
        }
      }

      const sep = document.createElement('span');
      sep.className = 'xas-sep';
      pill.appendChild(sep);

      if (isStitchedItem) {
        pill.appendChild(
          makeIconButton({
            icon: 'swap_horiz',
            title: t('orderBtnTitle'),
            active: state.showOrderEditor,
            onClick: () => {
              state.showOrderEditor = !state.showOrderEditor;
              state.selectedSlot = null;
              renderToolbar();
            },
          }),
        );
      }

      pill.appendChild(
        makeIconButton({
          icon: 'zoom_in',
          title: t('zoomTitle'),
          onClick: callbacks.onOpenLightbox,
        }),
      );
      pill.appendChild(
        makeIconButton({
          icon: 'content_copy',
          title: t('copyTitle'),
          onClick: callbacks.onCopy,
        }),
      );
      pill.appendChild(
        makeIconButton({
          icon: 'download',
          title: t('downloadTitle'),
          onClick: callbacks.onDownload,
        }),
      );
    }

    pill.appendChild(
      makeIconButton({
        icon: 'settings',
        title: t('settingsTitle'),
        onClick: callbacks.onOpenSettings,
      }),
    );

    toolbar.appendChild(pill);

    // Optional inline tile-order swapper bar for the active stitched item
    if (isStitchedItem && state.showOrderEditor) {
      const orderBar = document.createElement('div');
      orderBar.className = 'xas-order-bar';

      const hint = document.createElement('span');
      hint.className = 'xas-order-hint';
      hint.textContent = t('orderHint');
      orderBar.appendChild(hint);

      activeItem.order.forEach((localIdx, slotPos) => {
        const origTweetIdx = activeItem.indices[localIdx];
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className =
          state.selectedSlot === slotPos ? 'xas-slot-chip xas-slot-selected' : 'xas-slot-chip';
        chip.textContent = String(origTweetIdx + 1);
        chip.addEventListener('click', (e) => {
          stopBubble(e);
          if (state.selectedSlot === null) {
            state.selectedSlot = slotPos;
            renderToolbar();
            return;
          }
          if (state.selectedSlot === slotPos) {
            state.selectedSlot = null;
            renderToolbar();
            return;
          }
          const nextOrder = activeItem.order.slice();
          const a = state.selectedSlot;
          [nextOrder[a], nextOrder[slotPos]] = [nextOrder[slotPos], nextOrder[a]];
          state.selectedSlot = null;
          callbacks.onChangeOrder(nextOrder);
        });
        orderBar.appendChild(chip);
      });

      const autoOrderBtn = document.createElement('button');
      autoOrderBtn.type = 'button';
      autoOrderBtn.className = 'xas-btn xas-btn-accent';
      appendIconLabel(autoOrderBtn, 'auto_awesome', t('autoOrder'), 14);
      autoOrderBtn.addEventListener('click', (e) => {
        stopBubble(e);
        callbacks.onAutoSolve(activeItem.layout);
      });
      orderBar.appendChild(autoOrderBtn);

      const resetOrderBtn = document.createElement('button');
      resetOrderBtn.type = 'button';
      resetOrderBtn.className = 'xas-btn';
      appendIconLabel(resetOrderBtn, 'restart_alt', t('resetOrder'), 14);
      resetOrderBtn.addEventListener('click', (e) => {
        stopBubble(e);
        callbacks.onChangeOrder(Array.from({ length: activeItem.indices.length }, (_, i) => i));
      });
      orderBar.appendChild(resetOrderBtn);

      toolbar.appendChild(orderBar);
    }
  };

  renderToolbar();

  const showGallery = ({ items, activeIndex = 0 }) => {
    state.active = true;
    state.busy = false;
    state.items = items;
    state.activeIndex = Math.max(0, Math.min(items.length - 1, activeIndex));
    const current = getActiveItem();
    if (!current || current.type !== 'stitched') {
      state.showOrderEditor = false;
      state.selectedSlot = null;
    }

    updateStageView();
    stage.style.display = 'flex';
    container.classList.add('xas-active');
    renderToolbar();
  };

  return {
    setBusy(isBusy) {
      state.busy = isBusy;
      renderToolbar();
    },
    setSuggested(suggestion) {
      state.suggested = suggestion;
      renderToolbar();
    },
    showGallery,
    showOriginal() {
      state.active = false;
      state.busy = false;
      state.showOrderEditor = false;
      state.selectedSlot = null;
      state.items = [];
      state.activeIndex = 0;
      stage.style.display = 'none';
      container.classList.remove('xas-active');
      renderToolbar();
    },
    destroy() {
      container.classList.remove('xas-active', 'xas-root');
      stage.remove();
      toolbar.remove();
    },
  };
}

function formatVideoProgressText(info) {
  if (!info) return '';
  if (info.stage === 'fetch') return t('stageFetch');
  const pct =
    typeof info.progress === 'number' ? `${Math.round(info.progress * 100)}%` : '';
  if (info.stage === 'extract') {
    return `${t('stageExtract')} ${pct}`.trim();
  }
  if (info.stage === 'encode') {
    return `${t('stageEncode')} ${pct}`.trim();
  }
  return pct || t('stageFetch');
}

/**
 * Manage the floating GIF / MP4 export toolbar overlaid on an X GIF or video player.
 */
export function createVideoUI(videoTarget, callbacks) {
  const { container } = videoTarget;
  container.classList.add('xas-video-root');

  const toolbar = document.createElement('div');
  toolbar.className = 'xas-injected xas-video-toolbar';

  for (const evtName of ['click', 'pointerdown', 'mousedown', 'touchstart']) {
    toolbar.addEventListener(evtName, (e) => {
      if (evtName === 'click') {
        stopBubble(e);
      } else {
        e.stopPropagation();
      }
    });
  }

  container.appendChild(toolbar);

  const state = {
    classification: videoTarget.classification || 'video',
    expanded: false,
    visible: videoTarget.visible !== false,
    busy: null, // null | { stage, progress, frame, total }
  };

  let progressLabelEl = null;
  let progressBarEl = null;

  const updateProgressDom = () => {
    if (!state.busy || !progressLabelEl || !progressBarEl) return;
    progressLabelEl.textContent = formatVideoProgressText(state.busy);
    if (typeof state.busy.progress === 'number') {
      progressBarEl.classList.remove('xas-m3-progress-indeterminate');
      const pct = Math.max(0, Math.min(100, Math.round(state.busy.progress * 100)));
      progressBarEl.style.width = `${pct}%`;
    } else {
      progressBarEl.classList.add('xas-m3-progress-indeterminate');
      progressBarEl.style.width = '';
    }
  };

  const render = () => {
    toolbar.style.display = state.visible ? 'flex' : 'none';
    if (!state.visible) return;

    progressLabelEl = null;
    progressBarEl = null;
    toolbar.textContent = '';
    toolbar.classList.toggle(
      'xas-expanded',
      Boolean(state.busy) || state.expanded || state.classification !== 'video',
    );

    const pill = document.createElement('div');

    if (state.busy) {
      pill.className = 'xas-pill xas-progress-pill';

      const row = document.createElement('div');
      row.className = 'xas-progress-row';

      const spinner = document.createElement('span');
      spinner.className = 'xas-spinner';

      progressLabelEl = document.createElement('span');
      progressLabelEl.className = 'xas-progress-label';

      const cancelBtn = makeIconButton({
        icon: 'stop',
        title: t('cancelGifTitle'),
        size: 14,
        onClick: () => callbacks.onCancel?.(),
      });

      row.appendChild(spinner);
      row.appendChild(progressLabelEl);
      row.appendChild(cancelBtn);

      const track = document.createElement('div');
      track.className = 'xas-m3-progress-track';
      progressBarEl = document.createElement('div');
      progressBarEl.className = 'xas-m3-progress-bar';
      track.appendChild(progressBarEl);

      pill.appendChild(row);
      pill.appendChild(track);
      toolbar.appendChild(pill);
      updateProgressDom();
      return;
    }

    if (state.classification === 'native_gif' || state.classification === 'gif_like_video') {
      pill.className = 'xas-pill xas-suggested';

      const gifBtn = document.createElement('button');
      gifBtn.type = 'button';
      gifBtn.className = 'xas-btn xas-btn-accent';
      const isGifLike = state.classification === 'gif_like_video';
      gifBtn.title = isGifLike ? t('saveGifLikeTitle') : t('saveGifTitle');
      appendIconLabel(gifBtn, isGifLike ? 'auto_awesome' : 'gif_box', t('gifLabel'), 15);
      gifBtn.addEventListener('click', (e) => {
        stopBubble(e);
        callbacks.onExportGif?.();
      });

      const sep = document.createElement('span');
      sep.className = 'xas-sep';

      const mp4Btn = document.createElement('button');
      mp4Btn.type = 'button';
      mp4Btn.className = 'xas-btn';
      mp4Btn.title = t('downloadMp4Title');
      mp4Btn.textContent = t('mp4Label');
      mp4Btn.addEventListener('click', (e) => {
        stopBubble(e);
        callbacks.onDownloadMp4?.();
      });

      pill.appendChild(gifBtn);
      pill.appendChild(sep);
      pill.appendChild(mp4Btn);
      pill.appendChild(
        makeIconButton({
          icon: 'settings',
          title: t('settingsTitle'),
          size: 15,
          onClick: () => callbacks.onOpenSettings?.(),
        }),
      );
      toolbar.appendChild(pill);
      return;
    }

    if (!state.expanded) {
      pill.className = 'xas-pill xas-collapsed';
      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'xas-btn';
      trigger.title = t('expandVideoToolsTitle');
      appendIconLabel(trigger, 'gif_box', t('gifLabel'), 15);
      trigger.addEventListener('click', (e) => {
        stopBubble(e);
        state.expanded = true;
        render();
      });
      pill.appendChild(trigger);
      toolbar.appendChild(pill);
      return;
    }

    pill.className = 'xas-pill';
    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'xas-btn xas-btn-accent';
    exportBtn.title = t('saveGifTitle');
    appendIconLabel(exportBtn, 'gif_box', t('exportGifLabel'), 15);
    exportBtn.addEventListener('click', (e) => {
      stopBubble(e);
      callbacks.onExportGif?.();
    });

    const mp4Btn = document.createElement('button');
    mp4Btn.type = 'button';
    mp4Btn.className = 'xas-btn';
    mp4Btn.title = t('downloadMp4Title');
    appendIconLabel(mp4Btn, 'movie', t('mp4Label'), 15);
    mp4Btn.addEventListener('click', (e) => {
      stopBubble(e);
      callbacks.onDownloadMp4?.();
    });

    pill.appendChild(exportBtn);
    pill.appendChild(mp4Btn);
    pill.appendChild(
      makeIconButton({
        icon: 'settings',
        title: t('settingsTitle'),
        size: 15,
        onClick: () => callbacks.onOpenSettings?.(),
      }),
    );
    pill.appendChild(
      makeIconButton({
        icon: 'close',
        title: t('collapseVideoToolsTitle'),
        size: 15,
        onClick: () => {
          state.expanded = false;
          render();
        },
      }),
    );
    toolbar.appendChild(pill);
  };

  render();

  return {
    setClassification(kind) {
      if (state.classification === kind) return;
      state.classification = kind;
      render();
    },
    setProgress(info) {
      if (info && state.busy && progressLabelEl && progressBarEl) {
        state.busy = info;
        updateProgressDom();
        return;
      }
      state.busy = info || null;
      render();
    },
    setVisible(visible) {
      const next = Boolean(visible);
      if (state.visible === next) return;
      state.visible = next;
      render();
    },
    destroy() {
      container.classList.remove('xas-video-root');
      toolbar.remove();
    },
  };
}
