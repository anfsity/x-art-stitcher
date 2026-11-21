// ==UserScript==
// @name              X Art Stitcher
// @name:zh-CN        X 画师拼图自动还原
// @namespace         https://github.com/anfsity/x-art-stitcher
// @version           1.0.0
// @description       Automatically detect, unshuffle, and stitch multi-image artist artworks on X (Twitter), including 2x2 grids and 20-image carousels, with fullscreen lightbox, lossless download, and clipboard copy.
// @description:zh-CN 自动识别并拼合 X (Twitter) 上画师发布的多图/四宫格/长图/多图轮播及防 AI 乱序切片作品，支持高清灯箱预览、原图下载与一键复制。
// @author            anfsity
// @license           Apache-2.0
// @homepageURL       https://github.com/anfsity/x-art-stitcher
// @supportURL        https://github.com/anfsity/x-art-stitcher/issues
// @updateURL         https://raw.githubusercontent.com/anfsity/x-art-stitcher/main/dist/x-art-stitcher.user.js
// @downloadURL       https://raw.githubusercontent.com/anfsity/x-art-stitcher/main/dist/x-art-stitcher.user.js
// @match             https://x.com/*
// @match             https://twitter.com/*
// @match             https://mobile.x.com/*
// @match             https://mobile.twitter.com/*
// @connect           pbs.twimg.com
// @grant             GM_xmlhttpRequest
// @grant             GM_addStyle
// @grant             GM_getValue
// @grant             GM_setValue
// @grant             GM_registerMenuCommand
// @grant             GM_download
// @grant             unsafeWindow
// @run-at            document-start
// ==/UserScript==
