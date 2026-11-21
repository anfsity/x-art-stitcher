import { createIcon } from './icons.js';
import { getAvailableLayouts } from './stitcher.js';

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
  sensStrict: IS_ZH ? '严格（极少误判）' : 'Strict (fewest false positives)',
  sensNormal: IS_ZH ? '标准（推荐）' : 'Normal (recommended)',
  sensLoose: IS_ZH ? '宽松（适配大缝隙/重压缩）' : 'Loose (handles wider gaps)',
  optFormat: IS_ZH ? '下载图片格式' : 'Download format',
  optTemplate: IS_ZH ? '下载文件名模板' : 'Filename template',
  optTemplateDesc: IS_ZH
    ? '可用占位符: {handle}, {tweetId}, {layout}'
    : 'Placeholders: {handle}, {tweetId}, {layout}',
  optDebug: IS_ZH ? '控制台输出调试日志' : 'Console debug logging',
  save: IS_ZH ? '保存' : 'Save',
  cancel: IS_ZH ? '取消' : 'Cancel',
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

export function openSettingsModal(currentConfig, onSave) {
  const existing = document.querySelector('.xas-modal-backdrop');
  if (existing) existing.remove();

  const backdrop = document.createElement('div');
  backdrop.className = 'xas-modal-backdrop';

  const modal = document.createElement('div');
  modal.className = 'xas-modal';

  const head = document.createElement('div');
  head.className = 'xas-modal-head';
  const heading = document.createElement('h3');
  heading.textContent = t('settingsHeading');
  const closeX = makeIconButton({
    icon: 'close',
    title: t('lbClose'),
    size: 18,
    onClick: () => backdrop.remove(),
  });
  head.appendChild(heading);
  head.appendChild(closeX);

  const body = document.createElement('div');
  body.className = 'xas-modal-body';

  const draft = { ...currentConfig };

  const addToggle = (label, desc, key) => {
    const row = document.createElement('label');
    row.className = 'xas-field';
    const left = document.createElement('div');
    const titleDiv = document.createElement('div');
    titleDiv.textContent = label;
    const descDiv = document.createElement('div');
    descDiv.className = 'xas-field-desc';
    descDiv.textContent = desc;
    left.appendChild(titleDiv);
    if (desc) left.appendChild(descDiv);

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'xas-checkbox';
    input.checked = Boolean(draft[key]);
    input.addEventListener('change', () => {
      draft[key] = input.checked;
    });

    row.appendChild(left);
    row.appendChild(input);
    body.appendChild(row);
  };

  const addSelect = (label, key, options) => {
    const row = document.createElement('label');
    row.className = 'xas-field';
    const text = document.createElement('span');
    text.textContent = label;
    const select = document.createElement('select');
    select.className = 'xas-select';
    for (const opt of options) {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      if (draft[key] === opt.value) o.selected = true;
      select.appendChild(o);
    }
    select.addEventListener('change', () => {
      draft[key] = select.value;
    });
    row.appendChild(text);
    row.appendChild(select);
    body.appendChild(row);
  };

  addToggle(t('optAutoDetect'), t('optAutoDetectDesc'), 'autoDetect');
  addToggle(t('optAutoStitch'), t('optAutoStitchDesc'), 'autoStitch');
  addToggle(t('optAutoUnshuffle'), t('optAutoUnshuffleDesc'), 'autoUnshuffle');
  addSelect(t('optSensitivity'), 'sensitivity', [
    { value: 'strict', label: t('sensStrict') },
    { value: 'normal', label: t('sensNormal') },
    { value: 'loose', label: t('sensLoose') },
  ]);
  addSelect(t('optFormat'), 'downloadFormat', [
    { value: 'png', label: 'PNG (Lossless)' },
    { value: 'jpeg', label: 'JPEG (95%)' },
    { value: 'webp', label: 'WebP (95%)' },
  ]);

  const tplWrap = document.createElement('label');
  tplWrap.className = 'xas-field-col';
  const tplLabel = document.createElement('span');
  tplLabel.textContent = t('optTemplate');
  const tplInput = document.createElement('input');
  tplInput.type = 'text';
  tplInput.className = 'xas-input';
  tplInput.value = draft.filenameTemplate;
  tplInput.addEventListener('input', () => {
    draft.filenameTemplate = tplInput.value;
  });
  const tplDesc = document.createElement('span');
  tplDesc.className = 'xas-field-desc';
  tplDesc.textContent = t('optTemplateDesc');
  tplWrap.appendChild(tplLabel);
  tplWrap.appendChild(tplInput);
  tplWrap.appendChild(tplDesc);
  body.appendChild(tplWrap);

  addToggle(t('optDebug'), '', 'debug');

  const foot = document.createElement('div');
  foot.className = 'xas-modal-foot';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'xas-lb-btn';
  cancelBtn.textContent = t('cancel');
  cancelBtn.addEventListener('click', () => backdrop.remove());

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'xas-lb-btn xas-lb-primary';
  saveBtn.textContent = t('save');
  saveBtn.addEventListener('click', () => {
    onSave(draft);
    backdrop.remove();
  });

  foot.appendChild(cancelBtn);
  foot.appendChild(saveBtn);

  modal.appendChild(head);
  modal.appendChild(body);
  modal.appendChild(foot);
  backdrop.appendChild(modal);

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.remove();
  });

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
