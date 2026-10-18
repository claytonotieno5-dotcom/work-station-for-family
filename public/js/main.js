document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.enquiry-form').forEach((form) => {
    const method = form.querySelector('[name="contact_method"]');
    const contact = form.querySelector('[name="customer_contact"]');
    if (!method || !contact) return;

    const updateContactField = () => {
      const isEmail = method.value === 'Email';
      contact.type = isEmail ? 'email' : 'tel';
      contact.autocomplete = isEmail ? 'email' : 'tel';
      contact.placeholder = isEmail ? 'you@example.com' : '+254 7xx xxx xxx';
      contact.setAttribute('aria-label', isEmail ? 'Your email address' : 'Your WhatsApp number');
    };
    method.addEventListener('change', updateContactField);
    updateContactField();
  });

  const intro = document.getElementById('introOverlay');
  if (intro) {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const shouldHide = () => intro.classList.add('hidden');
    if (prefersReduced) {
      shouldHide();
    } else {
      setTimeout(shouldHide, 1800);
    }
    const skip = document.getElementById('skipIntro');
    if (skip) skip.addEventListener('click', shouldHide);
  }

  const reveals = document.querySelectorAll('.reveal');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });

  reveals.forEach((item) => observer.observe(item));
});
