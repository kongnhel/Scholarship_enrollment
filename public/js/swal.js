function Swal() {}

Swal.fire = function(opts) {
  return new Promise(function(resolve) {
    var title = opts.title || '';
    var text = opts.text || '';
    var html = opts.html || '';
    var icon = opts.icon || '';
    var iconHtml = opts.iconHtml || '';
    var confirmButtonText = opts.confirmButtonText || 'OK';
    var cancelButtonText = opts.cancelButtonText || 'Cancel';
    var showCancelButton = opts.showCancelButton || false;
    var showCloseButton = opts.showCloseButton || false;
    var allowOutsideClick = opts.allowOutsideClick !== false;
    var allowEscapeKey = opts.allowEscapeKey !== false;
    var timer = opts.timer || 0;
    var customClass = opts.customClass || {};
    var reverseButtons = opts.reverseButtons || false;
    var backdrop = opts.backdrop !== false;

    var existing = document.getElementById('swal2-container');
    if (existing) existing.remove();

    var iconColor = {
      success: { bg: 'bg-emerald-100 dark:bg-emerald-900/40', ring: 'ring-emerald-200 dark:ring-emerald-800', icon: 'bi-check-lg', text: 'text-emerald-500', anim: 'swal2-icon-success' },
      error: { bg: 'bg-rose-100 dark:bg-rose-900/40', ring: 'ring-rose-200 dark:ring-rose-800', icon: 'bi-x-lg', text: 'text-rose-500', anim: 'swal2-icon-error' },
      warning: { bg: 'bg-amber-100 dark:bg-amber-900/40', ring: 'ring-amber-200 dark:ring-amber-800', icon: 'bi-exclamation-triangle', text: 'text-amber-500', anim: 'swal2-icon-warning' },
      info: { bg: 'bg-sky-100 dark:bg-sky-900/40', ring: 'ring-sky-200 dark:ring-sky-800', icon: 'bi-info-lg', text: 'text-sky-500', anim: 'swal2-icon-info' },
      question: { bg: 'bg-violet-100 dark:bg-violet-900/40', ring: 'ring-violet-200 dark:ring-violet-800', icon: 'bi-question-lg', text: 'text-violet-500', anim: 'swal2-icon-question' }
    };

    var iconConfig = iconColor[icon] || iconColor.info;

    var iconHtmlStr = '';
    if (iconHtml) {
      iconHtmlStr = '<div class="swal2-icon-html ' + iconConfig.bg + ' ' + iconConfig.ring + ' ring-2 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 animate__animated animate__bounceIn"><span class="text-2xl ' + iconConfig.text + '">' + iconHtml + '</span></div>';
    } else if (icon) {
      iconHtmlStr = '<div class="swal2-icon ' + iconConfig.bg + ' ' + iconConfig.ring + ' ring-2 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 animate__animated animate__bounceIn"><i class="bi ' + iconConfig.icon + ' text-2xl ' + iconConfig.text + '"></i></div>';
    }

    var titleStr = title ? '<h2 class="swal2-title text-xl font-bold text-gray-900 dark:text-white mb-2">' + title + '</h2>' : '';
    var textStr = text ? '<p class="swal2-text text-gray-600 dark:text-gray-300 text-sm">' + text + '</p>' : '';
    var htmlStr = html ? '<div class="swal2-html-content text-gray-600 dark:text-gray-300 text-sm">' + html + '</div>' : '';

    var closeBtn = showCloseButton ? '<button type="button" class="swal2-close absolute top-3 right-3 w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-all" aria-label="Close"><i class="bi bi-x text-sm"></i></button>' : '';

    var cancelBtn = showCancelButton ? '<button type="button" class="swal2-cancel btn-cancel px-5 py-2.5 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm font-semibold hover:bg-gray-50 dark:hover:bg-gray-600 transition-all focus:outline-none focus:ring-2 focus:ring-gray-200 dark:focus:ring-gray-600">' + cancelButtonText + '</button>' : '';
    var confirmBtn = '<button type="button" class="swal2-confirm btn-confirm px-5 py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 transition-all focus:outline-none focus:ring-2 focus:ring-green-300 dark:focus:ring-green-800 shadow-sm">' + confirmButtonText + '</button>';

    var buttonsHtml = reverseButtons
      ? '<div class="swal2-actions flex items-center justify-center gap-3 mt-6">' + confirmBtn + cancelBtn + '</div>'
      : '<div class="swal2-actions flex items-center justify-center gap-3 mt-6">' + cancelBtn + confirmBtn + '</div>';

    var confirmColor = {
      success: 'bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-300 dark:focus:ring-emerald-800',
      error: 'bg-rose-600 hover:bg-rose-700 focus:ring-rose-300 dark:focus:ring-rose-800',
      warning: 'bg-amber-500 hover:bg-amber-600 focus:ring-amber-300 dark:focus:ring-amber-800',
      info: 'bg-sky-600 hover:bg-sky-700 focus:ring-sky-300 dark:focus:ring-sky-800',
      question: 'bg-violet-600 hover:bg-violet-700 focus:ring-violet-300 dark:focus:ring-violet-800'
    };

    var container = document.createElement('div');
    container.id = 'swal2-container';
    container.className = 'swal2-container fixed inset-0 z-[10000] flex items-center justify-center p-4';
    container.style.cssText = 'animation: swal2FadeIn 0.2s ease-out;';

    var backdropEl = document.createElement('div');
    backdropEl.className = 'swal2-backdrop absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity';
    backdropEl.style.cssText = 'animation: swal2FadeIn 0.2s ease-out;';

    var popup = document.createElement('div');
    popup.className = 'swal2-popup relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-sm w-full p-8 text-center transform transition-all ' + (customClass.popup || '');
    popup.style.cssText = 'animation: swal2ZoomIn 0.25s ease-out;';

    var content = document.createElement('div');
    content.className = 'swal2-content';
    content.innerHTML = iconHtmlStr + titleStr + textStr + htmlStr + (showCancelButton || opts.confirmButtonText ? buttonsHtml : '');

    popup.appendChild(content);
    if (showCloseButton) popup.insertAdjacentHTML('afterbegin', closeBtn);

    container.appendChild(backdropEl);
    container.appendChild(popup);
    document.body.appendChild(container);

    var confirmBtnEl = popup.querySelector('.swal2-confirm');
    var cancelBtnEl = popup.querySelector('.swal2-cancel');
    var closeBtnEl = popup.querySelector('.swal2-close');

    if (confirmBtnEl && icon && confirmColor[icon]) {
      confirmBtnEl.className = confirmBtnEl.className.replace('bg-green-600 hover:bg-green-700 focus:ring-green-300 dark:focus:ring-green-800', confirmColor[icon]);
    }

    function close(result) {
      container.style.animation = 'swal2FadeOut 0.15s ease-in forwards';
      popup.style.animation = 'swal2ZoomOut 0.15s ease-in forwards';
      setTimeout(function() {
        container.remove();
        resolve(result);
      }, 150);
    }

    if (confirmBtnEl) {
      confirmBtnEl.addEventListener('click', function() { close({ isConfirmed: true, isDenied: false, isDismissed: false }); });
    }
    if (cancelBtnEl) {
      cancelBtnEl.addEventListener('click', function() { close({ isConfirmed: false, isDenied: false, isDismissed: true }); });
    }
    if (closeBtnEl) {
      closeBtnEl.addEventListener('click', function() { close({ isConfirmed: false, isDenied: false, isDismissed: true }); });
    }
    if (allowOutsideClick) {
      backdropEl.addEventListener('click', function() { close({ isConfirmed: false, isDenied: false, isDismissed: true }); });
    }
    if (allowEscapeKey) {
      document.addEventListener('keydown', function handler(e) {
        if (e.key === 'Escape') {
          document.removeEventListener('keydown', handler);
          close({ isConfirmed: false, isDenied: false, isDismissed: true });
        }
      });
    }
    if (timer > 0) {
      setTimeout(function() { close({ isConfirmed: false, isDenied: false, isDismissed: true }); }, timer);
    }
  });
};

var _swalConfirmCallback = null;
function closeSwalConfirmModal(result) {
  _swalConfirmCallback = null;
}

function showConfirmModal(title, message, callback, danger) {
  var icon = danger ? 'warning' : 'question';
  var confirmBtnText = danger
    ? (typeof currentLang !== 'undefined' && currentLang === 'km' ? 'បញ្ជាក់' : 'Confirm')
    : (typeof currentLang !== 'undefined' && currentLang === 'km' ? 'យល់ព្រម' : 'OK');
  var cancelBtnText = typeof currentLang !== 'undefined' && currentLang === 'km' ? 'បោះបង់' : 'Cancel';

  Swal.fire({
    title: title,
    text: message,
    icon: icon,
    showCancelButton: true,
    showCloseButton: true,
    confirmButtonText: confirmBtnText,
    cancelButtonText: cancelBtnText,
    reverseButtons: true
  }).then(function(result) {
    if (callback) callback(result.isConfirmed);
  });
}

function closeAlertModal() {}
