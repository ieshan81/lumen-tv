/**
 * Drop-in for Watch JoJo. Turns on the 10-foot frame when the page is opened
 * with ?lumen=1 (the Lumen tile should use that query).
 * Does not change embed hosts and does not trap keyboard focus.
 * Lumen still owns Ctrl+Shift+H / Alt+Home.
 */
(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const enabled = params.get('lumen') === '1' || document.documentElement.dataset.lumen === '1';
  if (!enabled) return;

  document.documentElement.classList.add('lumen-tv');

  const FOCUSABLE = [
    '#shieldPlayBtn',
    '#shieldResumeBtn',
    '#prevEpisodeBtn',
    '#nextEpisodeBtn',
    '#loadEpisode',
    '#skipIntroBtn',
    '#watchFullscreenBtn',
    '#upNextBtn',
    '#nextEpisodeAutoBtn',
    '#watchCreditsBtn',
    '.watch-footer__back',
    '#seasonSelect',
    '#episodeSelect',
    '.source-bar__btns button',
    '.anime-lang-toggle__btn'
  ].join(', ');

  function markFocusable() {
    document.querySelectorAll(FOCUSABLE).forEach((el) => {
      if (el.hasAttribute('disabled') || el.hasAttribute('hidden')) return;
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
      el.classList.add('tv-focusable');
    });
  }

  markFocusable();
  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(markFocusable).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden', 'disabled']
    });
  }

  window.LumenTvShell = {
    enabled: true,
    markFocusable
  };
})();
