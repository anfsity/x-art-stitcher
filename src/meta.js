// ==UserScript==
// @name              X Art Stitcher
// @name:zh-CN        X 画师拼图自动还原
// @namespace         https://github.com/anfsity/x-art-stitcher
// @version           1.0.0
// @description       Automatically detect, unshuffle, and stitch multi-image artist artworks on X (Twitter), plus recognize GIFs and short silent videos for instant MP4-to-GIF / MP4 export with fullscreen lightbox, lossless download, and clipboard copy.
// @description:zh-CN 自动识别并拼合 X (Twitter) 上画师发布的多图/四宫格/长图/多图轮播及防 AI 乱序切片作品，并自动识别 GIF 与类 GIF 短视频，支持浏览器端无损转存 GIF / 下载 MP4 原视频与全屏高清灯箱预览。
// @author            anfsity
// @license           Apache-2.0
// @icon              data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iOCIgZmlsbD0iIzFkOWJmMCIvPjxnIHRyYW5zZm9ybT0idHJhbnNsYXRlKDQgNCkiPjxwYXRoIGZpbGw9IiNmZmYiIGQ9Ik0zIDN2OGg4VjNIM3ptNiA2SDVWNWg0djR6TTMgMTN2OGg4di04SDN6bTYgNkg1di00aDR2NHpNMTMgM3Y4aDhWM2gtOHptNiA2aC00VjVoNHY0ek0xMyAxM3Y4aDh2LThoLTh6bTYgNmgtNHYtNGg0djR6Ii8+PC9nPjwvc3ZnPg==
// @homepageURL       https://github.com/anfsity/x-art-stitcher
// @supportURL        https://github.com/anfsity/x-art-stitcher/issues
// @updateURL         https://raw.githubusercontent.com/anfsity/x-art-stitcher/main/dist/x-art-stitcher.user.js
// @downloadURL       https://raw.githubusercontent.com/anfsity/x-art-stitcher/main/dist/x-art-stitcher.user.js
// @match             https://x.com/*
// @match             https://twitter.com/*
// @match             https://mobile.x.com/*
// @match             https://mobile.twitter.com/*
// @connect           pbs.twimg.com
// @connect           video.twimg.com
// @grant             GM_xmlhttpRequest
// @grant             GM_addStyle
// @grant             GM_getValue
// @grant             GM_setValue
// @grant             GM_registerMenuCommand
// @grant             unsafeWindow
// @run-at            document-start
// ==/UserScript==
