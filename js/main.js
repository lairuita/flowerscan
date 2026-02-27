/* ============================================================
   main.js — Ikebana Box
   1. Hero phrase animation
   2. FAQ accordion
   3. Helcim checkout (HelcimPay.js modal)
   ============================================================ */

(function () {
  'use strict';

  /* ----------------------------------------------------------
     1. Hero Phrase Animation
     Cycles: "flowerscan" → "flower scan" → "flowers can"
     Each phrase: 1s fade in → 2.5s hold → 1s fade out → 1s pause
     Total per cycle: 16.5s. Pure opacity, no movement.
  ---------------------------------------------------------- */
  function initHeroPhrase() {
    var el = document.getElementById('hero-phrase');
    if (!el) return;

    var phrases = ['flowerscan', 'flower scan', 'flowers can'];
    var current = 0;

    function showNext() {
      el.textContent = phrases[current];

      // Fade in
      el.style.opacity = '1';

      // After fade in (1s) + hold (2.5s) = 3500ms, start fade out
      setTimeout(function () {
        el.style.opacity = '0';
      }, 3500);

      // After fade out completes (1s) + pause (1s) = 5500ms, show next
      setTimeout(function () {
        current = (current + 1) % phrases.length;
        showNext();
      }, 5500);
    }

    // Begin after a short delay so the hero has settled
    setTimeout(showNext, 1200);
  }


  /* ----------------------------------------------------------
     2. FAQ Accordion
     Toggles .is-open on .faq-item when its button is clicked.
     aria-expanded is kept in sync for accessibility.
  ---------------------------------------------------------- */
  function initFaqAccordion() {
    var questions = document.querySelectorAll('.faq-item__question');
    if (!questions.length) return;

    questions.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var item   = btn.closest('.faq-item');
        var isOpen = item.classList.contains('is-open');

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
     3. Helcim Checkout (HelcimPay.js modal)

     Flow:
       a. Button click → POST /api/create-checkout-session
          → { checkoutToken, secretToken }
       b. Load HelcimPay.js script, then call
          appendHelcimPayIframe(checkoutToken)
       c. Listen for window 'message' event from the iframe
       d. On SUCCESS → POST /api/webhook with transaction data
          → redirect to success.html
       e. On ABORTED/HIDE → restore button, remove iframe
  ---------------------------------------------------------- */
  function initCheckout() {
    var checkoutButtons = document.querySelectorAll('[data-checkout-type]');
    if (!checkoutButtons.length) return;

    checkoutButtons.forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var type         = btn.dataset.checkoutType;
        var workshopDate = btn.dataset.workshopDate || null;

        var originalText = btn.textContent;
        btn.textContent  = 'Loading…';
        btn.disabled     = true;

        try {
          // a. Init Helcim session
          var initRes = await fetch('/api/create-checkout-session', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ type }),
          });

          if (!initRes.ok) throw new Error('Init failed: ' + initRes.status);

          var { checkoutToken, secretToken } = await initRes.json();

          // b. Load HelcimPay.js then open modal
          await loadHelcimScript();
          appendHelcimPayIframe(checkoutToken);

          // c. Listen for payment result
          window.addEventListener('message', async function onPayment(event) {
            // Only handle events for this checkout session
            if (event.data?.eventName !== 'helcim-pay-js-' + checkoutToken) return;

            var status  = event.data.eventStatus;
            var message = event.data.eventMessage || {};

            if (status === 'SUCCESS') {
              window.removeEventListener('message', onPayment);

              try {
                // d. Post transaction to our backend for Sheets + email
                var webhookRes = await fetch('/api/webhook', {
                  method:  'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body:    JSON.stringify({
                    transactionData: message.data,
                    hash:            message.hash,
                    secretToken,
                    type,
                    workshopDate,
                  }),
                });

                if (!webhookRes.ok) {
                  // Backend processing failed — still redirect, log the error
                  console.error('Webhook error:', webhookRes.status);
                }
              } catch (webhookErr) {
                console.error('Webhook fetch error:', webhookErr);
              }

              // Redirect regardless — payment succeeded
              window.location.href = '/success.html?type=' + type;

            } else if (status === 'ABORTED' || status === 'HIDE') {
              window.removeEventListener('message', onPayment);
              removeHelcimIframe();
              btn.textContent = originalText;
              btn.disabled    = false;
            }
          });

        } catch (err) {
          console.error('Checkout error:', err);
          btn.textContent = originalText;
          btn.disabled    = false;
          showCheckoutError(btn);
        }
      });
    });
  }

  // Load the HelcimPay.js script once
  function loadHelcimScript() {
    return new Promise(function (resolve, reject) {
      if (document.getElementById('helcim-pay-script')) {
        resolve();
        return;
      }
      var script   = document.createElement('script');
      script.id    = 'helcim-pay-script';
      script.src   = 'https://api.helcim.com/v2/helcim-pay.js';
      script.onload  = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function removeHelcimIframe() {
    var iframe = document.getElementById('helcimPayIframe');
    if (iframe) iframe.remove();
    // Also remove any overlay Helcim may have added
    var overlay = document.querySelector('.helcim-pay-overlay');
    if (overlay) overlay.remove();
  }

  function showCheckoutError(nearElement) {
    var existing = document.getElementById('checkout-error-msg');
    if (existing) existing.remove();

    var msg = document.createElement('p');
    msg.id            = 'checkout-error-msg';
    msg.textContent   = 'Something went wrong. Please try again or email hello@flowerscan.ca.';
    msg.style.cssText = [
      'font-size:0.875rem',
      'color:#9E9E8F',
      'margin-top:0.75rem',
      'font-style:italic',
    ].join(';');

    nearElement.insertAdjacentElement('afterend', msg);
    setTimeout(function () { msg.remove(); }, 6000);
  }


  /* ----------------------------------------------------------
     Init
  ---------------------------------------------------------- */
  document.addEventListener('DOMContentLoaded', function () {
    initHeroPhrase();
    initFaqAccordion();
    initCheckout();
  });

}());
