/**
 * Accessible confirmation dialogs.
 *
 * The pages used to call window.confirm() / window.prompt(), which block the
 * main thread, cannot be styled, and are announced inconsistently. These
 * helpers render a native <dialog> instead, so the browser provides the modal
 * semantics (inert background, focus containment, Escape) and we add labelled
 * text, explicit buttons and focus restoration on top.
 *
 * Both helpers resolve a Promise; nothing throws.
 */

let dialogCounter = 0;

/**
 * @param {object} options
 * @param {string} options.title            Heading text (required)
 * @param {string} options.message          Body text (required)
 * @param {string} [options.confirmLabel]   Confirm button label
 * @param {string} [options.cancelLabel]    Cancel button label
 * @param {"default"|"danger"} [options.tone]
 * @param {object} [options.input]          When present, renders a text input
 * @param {string} [options.input.label]
 * @param {string} [options.input.placeholder]
 * @param {string} [options.input.requiredValue]  Exact value required to confirm
 * @param {string} [options.input.errorMessage]
 * @returns {Promise<true|string|null>} true for a plain confirm, the entered
 *   string for an input dialog, or null when cancelled.
 */
function openDialog(options) {
  const {
    title,
    message,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    tone = "default",
    input = null,
  } = options;

  return new Promise((resolve) => {
    const id = `dialog-${++dialogCounter}`;
    const titleId = `${id}-title`;
    const messageId = `${id}-message`;
    const errorId = `${id}-error`;
    const inputId = `${id}-input`;

    const previouslyFocused = document.activeElement;

    const dialog = document.createElement("dialog");
    dialog.className = "dialog";
    dialog.setAttribute("aria-labelledby", titleId);
    dialog.setAttribute("aria-describedby", messageId);

    dialog.innerHTML = `
      <div class="dialog-panel">
        <div class="modal-header">
          <h2 class="modal-title" id="${titleId}"></h2>
          <button type="button" class="close-modal" data-dialog-cancel aria-label="Close dialog">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="modal-body">
          <p class="text-sm text-secondary" id="${messageId}" style="white-space: pre-line;"></p>
          ${input ? `
            <div class="form-field" style="margin-top: var(--space-5);">
              <label class="form-label" for="${inputId}"></label>
              <input class="input" id="${inputId}" type="text" autocomplete="off"
                     aria-describedby="${errorId}" aria-invalid="false">
              <p class="form-error" id="${errorId}" role="alert" hidden></p>
            </div>` : ""}
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" data-dialog-cancel></button>
          <button type="button" class="btn ${tone === "danger" ? "btn-danger" : "btn-primary"}" data-dialog-confirm></button>
        </div>
      </div>
    `;

    // Text is assigned with textContent so user data can never become markup.
    dialog.querySelector(`#${titleId}`).textContent = title;
    dialog.querySelector(`#${messageId}`).textContent = message;
    dialog.querySelector("[data-dialog-confirm]").textContent = confirmLabel;
    dialog.querySelectorAll("[data-dialog-cancel]").forEach((btn) => {
      if (btn.classList.contains("btn")) btn.textContent = cancelLabel;
    });

    let inputEl = null;
    let errorEl = null;
    if (input) {
      inputEl = dialog.querySelector(`#${inputId}`);
      errorEl = dialog.querySelector(`#${errorId}`);
      dialog.querySelector(`label[for="${inputId}"]`).textContent = input.label || "Value";
      if (input.placeholder) inputEl.placeholder = input.placeholder;
    }

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      // Restore focus to whatever opened the dialog — unless that control now
      // lives inside a modal the caller closed (the delete flows close their
      // detail modal first). In that case move focus to the page content so
      // keyboard users are not left on a hidden button.
      const canRestore =
        previouslyFocused &&
        previouslyFocused.isConnected &&
        !previouslyFocused.closest(".modal-overlay:not(.open)");
      if (canRestore) {
        previouslyFocused.focus({ preventScroll: true });
      } else {
        const main = document.querySelector("main");
        if (main) {
          if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
          main.focus({ preventScroll: true });
        }
      }
      resolve(value);
    };

    const showError = (text) => {
      if (!errorEl) return;
      errorEl.textContent = text;
      errorEl.hidden = false;
      inputEl.setAttribute("aria-invalid", "true");
      inputEl.classList.add("error");
      inputEl.focus();
    };

    const clearError = () => {
      if (!errorEl) return;
      errorEl.hidden = true;
      inputEl.setAttribute("aria-invalid", "false");
      inputEl.classList.remove("error");
    };

    dialog.querySelectorAll("[data-dialog-cancel]").forEach((btn) => {
      btn.addEventListener("click", () => finish(null));
    });

    dialog.querySelector("[data-dialog-confirm]").addEventListener("click", () => {
      if (!inputEl) {
        finish(true);
        return;
      }
      const value = inputEl.value.trim();
      if (input.requiredValue && value !== input.requiredValue) {
        showError(input.errorMessage || `Type ${input.requiredValue} to continue.`);
        return;
      }
      finish(value);
    });

    if (inputEl) {
      inputEl.addEventListener("input", clearError);
      inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          dialog.querySelector("[data-dialog-confirm]").click();
        }
      });
    }

    // Escape: cancel instead of leaving an unhandled dialog behind.
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      finish(null);
    });

    // Safety net: if the browser closes the dialog by any other path, settle the
    // promise instead of leaving the caller awaiting forever.
    dialog.addEventListener("close", () => {
      if (!settled) {
        settled = true;
        dialog.remove();
        resolve(null);
      }
    });

    // Clicking the backdrop (the dialog element itself, not its panel) cancels.
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) finish(null);
    });

    document.body.appendChild(dialog);
    dialog.showModal();

    if (inputEl) inputEl.focus();
    else dialog.querySelector("[data-dialog-confirm]").focus();
  });
}

/**
 * Ask the user to confirm an action.
 * @returns {Promise<boolean>} true only when the user confirms.
 */
export function confirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
} = {}) {
  return openDialog({ title, message, confirmLabel, cancelLabel, tone }).then(
    (result) => result === true
  );
}

/**
 * Ask the user to type a value before a destructive action.
 * @returns {Promise<string|null>} the entered value, or null when cancelled.
 */
export function promptDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  label = "Confirmation",
  placeholder = "",
  requiredValue = null,
  errorMessage = "",
} = {}) {
  return openDialog({
    title,
    message,
    confirmLabel,
    cancelLabel,
    tone,
    input: { label, placeholder, requiredValue, errorMessage },
  });
}
