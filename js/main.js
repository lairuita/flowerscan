/* ============================================================
   main.js — Ikebana Box
   1. FAQ accordion
   2. Stripe Checkout redirect
   ============================================================ */

(function () {
  'use strict';

  /* ----------------------------------------------------------
     1. FAQ Accordion
     Toggles .is-open on .faq-item when its button is clicked.
     aria-expanded is kept in sync for accessibility.
  ---------------------------------------------------------- */
  function initFaqAccordion() {
    var questions = document.querySelectorAll('.faq-item__question');
    if (!questions.length) return;

    questions.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var item     = btn.closest('.faq-item');
        var isOpen   = item.classList.contains('is-open');

        // Close all open items in the same list
        var list = btn.closest('.faq-list');
        if (list) {
          list.querySelectorAll('.faq-item.is-open').forEach(function (openItem) {
            openItem.classList.remove('is-open');
            openItem.querySelector('.faq-item__question')
                    .setAttribute('aria-expanded', 'false');
          });
        }

        // Open the clicked item (unless it was already open)
        if (!isOpen) {
          item.classList.add('is-open');
          btn.setAttribute('aria-expanded', 'true');
        }
      });
    });
  }


  /* ----------------------------------------------------------
     2. Stripe Checkout Redirect
     Any element with [data-checkout-type] triggers a POST to
     /api/create-checkout-session, then redirects to Stripe.
  ---------------------------------------------------------- */
  function initCheckout() {
    var checkoutButtons = document.querySelectorAll('[data-checkout-type]');
    if (!checkoutButtons.length) return;

    checkoutButtons.forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var type         = btn.dataset.checkoutType;
        var workshopDate = btn.dataset.workshopDate || null;

        // Visual feedback
        var originalText = btn.textContent;
        btn.textContent  = 'Loading…';
        btn.disabled     = true;

        try {
          var body = { type: type };
          if (workshopDate) body.workshopDate = workshopDate;

          var response = await fetch('/api/create-checkout-session', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(body),
          });

          if (!response.ok) {
            throw new Error('Server error ' + response.status);
          }

          var data = await response.json();

          if (data.url) {
            window.location.href = data.url;
          } else {
            throw new Error('No checkout URL returned');
          }

        } catch (err) {
          console.error('Checkout error:', err);
          btn.textContent = originalText;
          btn.disabled    = false;
          // Minimal inline error — no modal, no confetti
          showCheckoutError(btn);
        }
      });
    });
  }

  function showCheckoutError(nearElement) {
    var existing = document.getElementById('checkout-error-msg');
    if (existing) existing.remove();

    var msg = document.createElement('p');
    msg.id            = 'checkout-error-msg';
    msg.textContent   = 'Something went wrong. Please try again or email hello@flowerscan.ca.';
    msg.style.cssText = [
      'font-size: 0.875rem',
      'color: #9E9E8F',
      'margin-top: 0.75rem',
      'font-style: italic',
    ].join(';');

    nearElement.insertAdjacentElement('afterend', msg);

    // Auto-remove after 6 seconds
    setTimeout(function () { msg.remove(); }, 6000);
  }


  /* ----------------------------------------------------------
     Init
  ---------------------------------------------------------- */
  document.addEventListener('DOMContentLoaded', function () {
    initFaqAccordion();
    initCheckout();
  });

}());
