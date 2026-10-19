document.addEventListener('DOMContentLoaded', () => {
  const statsRoot = document.getElementById('usage-stats');
  if (statsRoot) {
    fetch('/api/stats')
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Failed to load statistics')))
      .then((data) => {
        const cards = statsRoot.querySelectorAll('.stat-card strong');
        if (!cards.length) return;
        cards[0].textContent = data.registered_users ?? 0;
        cards[1].textContent = data.total_inquiries ?? 0;
        cards[2].textContent = data.inquiries_today ?? 0;
        cards[3].textContent = data.inquiries_this_week ?? 0;
      })
      .catch(() => {
        const cards = statsRoot.querySelectorAll('.stat-card strong');
        cards.forEach((card) => {
          card.textContent = 'Unavailable';
        });
      });
  }

  const notificationCount = document.getElementById('notification-count');
  if (notificationCount && window.dashboardRole) {
    const notificationButton = notificationCount.closest('.notification-button');
    const updateNotifications = () => {
      fetch(`/api/notifications?role=${encodeURIComponent(window.dashboardRole)}`, { credentials: 'same-origin' })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error('Notifications unavailable')))
        .then((data) => {
          notificationCount.textContent = String(data.total);
          notificationButton?.setAttribute('aria-label', `Notifications, ${data.total} pending updates`);
        })
        .catch(() => {
          notificationCount.textContent = '!';
          notificationButton?.setAttribute('aria-label', 'Notifications unavailable; refresh the dashboard to retry');
        });
    };
    updateNotifications();
    window.setInterval(updateNotifications, 30000);
  }

  const customerStatus = document.getElementById('customer-status');
  if (customerStatus) {
    fetch('/api/customer-status')
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Customer status unavailable')))
      .then((data) => {
        if (!data.welcome_back || !Array.isArray(data.existing_inquiries) || !data.existing_inquiries.length) return;
        customerStatus.hidden = false;
        const items = data.existing_inquiries.slice(0, 3).map((entry) => `<li><strong>${entry.subject || 'Inquiry'}</strong> — ${entry.status || 'Received'}</li>`).join('');
        customerStatus.innerHTML = `<h3>Welcome back</h3><p>You have ${data.existing_inquiries.length} existing inquiry${data.existing_inquiries.length > 1 ? 'ies' : 'y'}.</p><ul>${items}</ul>`;
      })
      .catch(() => {
        customerStatus.hidden = true;
      });
  }

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
  if (!('IntersectionObserver' in window)) {
    reveals.forEach((item) => item.classList.add('visible'));
    return;
  }

  document.body.classList.add('reveal-enabled');
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
