import { createIcon } from './icons.js';
import { getAvailableLayouts } from './stitcher.js';

const IS_ZH = typeof navigator !== 'undefined' && /^zh/i.test(navigator.language || '');

const TEXT = {
  stitch: IS_ZH ? '拼图' : 'Stitch',
  suggested: IS_ZH ? '检测到拼图' : 'Split Detected',
  original: IS_ZH ? '原图' : 'Orig',
  auto: IS_ZH ? '自动' : 'Auto',
  unshuffledBadge: IS_ZH ? '已自动复原顺序' : 'Auto Unshuffled',
  orderBtnTitle: IS_ZH ? '调整切片顺序' : 'Adjust tile order',
  orderHint: IS_ZH ? '点击两块交换:' : 'Swap two:',
  autoOrder: IS_ZH ? '自动排序' : 'Auto',
  resetOrder: IS_ZH ? '默认' : 'Reset',
  zoomTitle: IS_ZH ? '全屏放大预览' : 'Fullscreen preview',
  downloadTitle: IS_ZH ? '下载拼合原图' : 'Download stitched image',
  copyTitle: IS_ZH ? '复制拼合图到剪贴板' : 'Copy image to clipboard',
  settingsTitle: IS_ZH ? '设置' : 'Settings',
  loading: IS_ZH ? '拼合中...' : 'Stitching...',
  lbFit: IS_ZH ? '适应窗口' : 'Fit',
  lbActual: '1:1',
  lbDownload: IS_ZH ? '下载原图' : 'Download',
  lbCopy: IS_ZH ? '复制图片' : 'Copy',
  lbClose: IS_ZH ? '关闭' : 'Close',
  lbFooter: IS_ZH
    ? '滚轮缩放 · 拖拽平移 · 单击切换适应/原尺寸 · 快捷键: D 下载 / C 复制 / 0 适应 / ESC 关闭'
    : 'Wheel to zoom · Drag to pan · Click toggles Fit/1:1 · Keys: D download / C copy / 0 fit / ESC close',
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

export function openLightbox({ url, title, width, height, onDownload, onCopy }) {
  const existing = document.querySelector('.xas-lightbox');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'xas-lightbox';

  const header = document.createElement('div');
  header.className = 'xas-lb-header';

  const titleEl = document.createElement('div');
  titleEl.className = 'xas-lb-title';
  titleEl.textContent = `${title} · ${width}×${height}`;

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
  img.src = url;
  img.alt = title;
  viewport.appendChild(img);

  const footer = document.createElement('div');
  footer.className = 'xas-lb-footer';
  footer.textContent = t('lbFooter');

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
    return Math.min(1, availW / Math.max(1, width), availH / Math.max(1, height));
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
      onDownload();
    } else if (e.key.toLowerCase() === 'c') {
      stopBubble(e);
      onCopy();
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
    if (e.button !== 0) return;
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
  actions.appendChild(makeBtn(t('lbCopy'), false, onCopy, 'content_copy'));
  actions.appendChild(makeBtn(t('lbDownload'), true, onDownload, 'download'));
  actions.appendChild(makeBtn(t('lbClose'), false, close, 'close'));

  header.appendChild(titleEl);
  header.appendChild(actions);
  overlay.appendChild(header);
  overlay.appendChild(viewport);
  overlay.appendChild(footer);

  document.body.appendChild(overlay);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('resize', onResize);

  requestAnimationFrame(setFit);
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
 * Manage the injected UI controls and stitched preview stage for a single tweet gallery.
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

  const previewImg = document.createElement('img');
  previewImg.className = 'xas-preview';
  previewImg.addEventListener('click', (e) => {
    stopBubble(e);
    callbacks.onOpenLightbox();
  });

  const metaBadge = document.createElement('div');
  metaBadge.className = 'xas-meta-badge';

  stage.appendChild(previewImg);
  stage.appendChild(metaBadge);

  container.appendChild(stage);
  container.appendChild(toolbar);

  const state = {
    stitched: false,
    busy: false,
    expanded: false,
    showOrderEditor: false,
    selectedSlot: null,
    activeLayout: null,
    order: Array.from({ length: urls.length }, (_, i) => i),
    suggested: null, // { layout, order, wasUnshuffled }
    wasUnshuffled: false,
    width: 0,
    height: 0,
  };

  const layouts = getAvailableLayouts(urls.length);

  const renderToolbar = () => {
    toolbar.textContent = '';
    toolbar.classList.toggle('xas-expanded', state.expanded || state.stitched);

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

    if (!state.stitched && !state.expanded) {
      pill.classList.add(state.suggested ? 'xas-suggested' : 'xas-collapsed');
      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = state.suggested ? 'xas-btn xas-btn-accent' : 'xas-btn';
      if (state.suggested) {
        appendIconLabel(
          trigger,
          'auto_awesome',
          `${t('suggested')} (${getLayoutLabel(state.suggested.layout)})`,
          15,
        );
      } else {
        appendIconLabel(trigger, 'grid_view', t('stitch'), 15);
      }
      trigger.addEventListener('click', (e) => {
        stopBubble(e);
        if (state.suggested) {
          callbacks.onSelectLayout(state.suggested.layout, state.suggested.order, state.suggested.wasUnshuffled);
        } else {
          state.expanded = true;
          renderToolbar();
        }
      });
      pill.appendChild(trigger);
      toolbar.appendChild(pill);
      return;
    }

    // Restore original view button (or collapse if not stitched)
    const origBtn = document.createElement('button');
    origBtn.type = 'button';
    origBtn.className = state.stitched ? 'xas-btn' : 'xas-btn xas-btn-active';
    origBtn.textContent = t('original');
    origBtn.addEventListener('click', (e) => {
      stopBubble(e);
      state.expanded = false;
      state.showOrderEditor = false;
      state.selectedSlot = null;
      if (state.stitched) {
        callbacks.onRestoreOriginal();
      } else {
        renderToolbar();
      }
    });
    pill.appendChild(origBtn);

    // Layout selector buttons
    for (const layout of layouts) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        state.stitched && state.activeLayout === layout ? 'xas-btn xas-btn-active' : 'xas-btn';
      btn.textContent = getLayoutLabel(layout);
      btn.addEventListener('click', (e) => {
        stopBubble(e);
        callbacks.onSelectLayout(layout, null, false);
      });
      pill.appendChild(btn);
    }

    if (!state.stitched) {
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
      const sep = document.createElement('span');
      sep.className = 'xas-sep';
      pill.appendChild(sep);

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

    // Optional inline tile-order swapper bar
    if (state.stitched && state.showOrderEditor) {
      const orderBar = document.createElement('div');
      orderBar.className = 'xas-order-bar';

      const hint = document.createElement('span');
      hint.className = 'xas-order-hint';
      hint.textContent = t('orderHint');
      orderBar.appendChild(hint);

      state.order.forEach((origIdx, slotPos) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className =
          state.selectedSlot === slotPos ? 'xas-slot-chip xas-slot-selected' : 'xas-slot-chip';
        chip.textContent = String(origIdx + 1);
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
          const nextOrder = state.order.slice();
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
        callbacks.onAutoSolve(state.activeLayout);
      });
      orderBar.appendChild(autoOrderBtn);

      const resetOrderBtn = document.createElement('button');
      resetOrderBtn.type = 'button';
      resetOrderBtn.className = 'xas-btn';
      appendIconLabel(resetOrderBtn, 'restart_alt', t('resetOrder'), 14);
      resetOrderBtn.addEventListener('click', (e) => {
        stopBubble(e);
        callbacks.onChangeOrder(Array.from({ length: urls.length }, (_, i) => i));
      });
      orderBar.appendChild(resetOrderBtn);

      toolbar.appendChild(orderBar);
    }
  };

  renderToolbar();

  return {
    setBusy(isBusy) {
      state.busy = isBusy;
      renderToolbar();
    },
    setSuggested(suggestion) {
      state.suggested = suggestion;
      renderToolbar();
    },
    showStitched({ objectUrl, layout, order, width, height, wasUnshuffled }) {
      state.stitched = true;
      state.busy = false;
      state.activeLayout = layout;
      state.order = order.slice();
      state.width = width;
      state.height = height;
      state.wasUnshuffled = Boolean(wasUnshuffled);

      previewImg.src = objectUrl;
      metaBadge.textContent = '';
      const parts = [getLayoutLabel(layout), `${width}×${height}`];
      if (state.wasUnshuffled) {
        metaBadge.appendChild(createIcon('auto_awesome', 14));
        parts.unshift(t('unshuffledBadge'));
      }
      const metaText = document.createElement('span');
      metaText.textContent = parts.join(' · ');
      metaBadge.appendChild(metaText);

      stage.style.display = 'flex';
      container.classList.add('xas-active');
      renderToolbar();
    },
    showOriginal() {
      state.stitched = false;
      state.busy = false;
      state.showOrderEditor = false;
      state.selectedSlot = null;
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
