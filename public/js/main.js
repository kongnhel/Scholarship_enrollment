document.addEventListener('DOMContentLoaded', function () {
  var isKm = typeof currentLang !== 'undefined' && currentLang === 'km';

  var passwordToggles = document.querySelectorAll('.password-toggle');
  passwordToggles.forEach(function (toggle) {
    toggle.addEventListener('click', function () {
      var input = this.previousElementSibling;
      if (input.type === 'password') {
        input.type = 'text';
        this.innerHTML = '<i class="bi bi-eye-slash"></i>';
      } else {
        input.type = 'password';
        this.innerHTML = '<i class="bi bi-eye"></i>';
      }
    });
  });

  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = this;
      var title = f.getAttribute('data-confirm-title') || (isKm ? 'តើអ្នកពិតជាចង់មែនទេ?' : 'Are you sure?');
      var msg = f.getAttribute('data-confirm');
      var danger = f.getAttribute('data-confirm-type') !== 'info';
      showConfirmModal(title, msg, function (ok) { if (ok) f.submit(); }, danger);
    });
  });

  var langToggle = document.getElementById('langToggle');
  if (langToggle) {
    langToggle.addEventListener('click', function () {
      var url = new URL(window.location.href);
      var currentLang = url.searchParams.get('lang');
      var newLang = currentLang === 'km' ? 'en' : 'km';
      url.searchParams.set('lang', newLang);
      window.location.href = url.toString();
    });
  }

  var fileInputs = document.querySelectorAll('input[type="file"]');
  fileInputs.forEach(function (input) {
    input.addEventListener('change', function () {
      var file = this.files[0];
      if (!file) return;

      var maxSize = 5 * 1024 * 1024;
      var allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];

      if (file.size > maxSize) {
        Swal.fire({
          title: isKm ? 'កំហុស' : 'Error',
          text: isKm ? 'ទំហំឯកសារត្រូវតែតូចជាង 5MB' : 'File size must be less than 5MB.',
          icon: 'error',
          confirmButtonText: isKm ? 'យល់ព្រម' : 'OK',
          showCloseButton: true
        });
        this.value = '';
        return;
      }

      if (!allowedTypes.includes(file.type)) {
        Swal.fire({
          title: isKm ? 'កំហុស' : 'Error',
          text: isKm ? 'តែឯកសារ JPG, PNG និង PDF ប៉ុណ្ណោះ' : 'Only JPG, PNG, and PDF files are allowed.',
          icon: 'error',
          confirmButtonText: isKm ? 'យល់ព្រម' : 'OK',
          showCloseButton: true
        });
        this.value = '';
        return;
      }

      var preview = this.parentElement.querySelector('.image-preview');
      if (preview && file.type.startsWith('image/')) {
        var reader = new FileReader();
        reader.onload = function (e) {
          preview.src = e.target.result;
          preview.style.display = 'block';
        };
        reader.readAsDataURL(file);
      }
    });
  });

  var uploadAreas = document.querySelectorAll('.upload-area');
  uploadAreas.forEach(function (area) {
    var input = area.querySelector('input[type="file"]');

    area.addEventListener('click', function () {
      if (input) input.click();
    });

    area.addEventListener('dragover', function (e) {
      e.preventDefault();
      this.classList.add('dragover');
    });

    area.addEventListener('dragleave', function () {
      this.classList.remove('dragover');
    });

    area.addEventListener('drop', function (e) {
      e.preventDefault();
      this.classList.remove('dragover');
      if (input && e.dataTransfer.files.length) {
        input.files = e.dataTransfer.files;
        input.dispatchEvent(new Event('change'));
      }
    });
  });

  var forms = document.querySelectorAll('form[data-loading]');
  forms.forEach(function (form) {
    form.addEventListener('submit', function () {
      var overlay = document.getElementById('spinnerOverlay');
      if (overlay) {
        overlay.style.display = 'flex';
      }
    });
  });

});
