/* ==========================================================================
   CareerFlow — Application Shell
   ==========================================================================
   Shared behaviour for the authenticated workspace:
   - Sidebar collapse (desktop) and drawer (mobile)
   - Account menu with sign out
   - Current user rendering
   ========================================================================== */

import { api } from "./api.js";
import { showToast, initials } from "./utils.js";
import { Dropdown } from "./dropdown.js";

/** Wire up the shell behaviour. */
export function mountShell({ active = "", title = "Overview" } = {}) {
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");
  const menuToggle = document.getElementById("menu-toggle");
  const headerTitle = document.getElementById("page-title");

  if (headerTitle) headerTitle.textContent = title;

  // --- Collapse (desktop) / drawer (mobile) ---
  let collapsed = false;
  const isMobile = () => window.innerWidth <= 768;
  const brandToggle = document.getElementById("sidebar-toggle");

  function closeDrawer() {
    sidebar?.classList.remove("mobile-open");
    backdrop?.classList.remove("open");
    menuToggle?.setAttribute("aria-expanded", "false");
  }

  /** Apply the collapsed state to the shell (sidebar, header, content). */
  function setCollapsed(next, announce = true) {
    collapsed = next;
    sidebar?.classList.toggle("collapsed", collapsed);
    menuToggle?.setAttribute("aria-expanded", String(!collapsed));
    if (brandToggle) {
      // The visible label is "CareerFlow", so it must stay in the accessible
      // name (WCAG "label in name").
      const label = collapsed
        ? "CareerFlow, expand sidebar"
        : "CareerFlow, collapse sidebar";
      brandToggle.setAttribute("aria-label", label);
      brandToggle.setAttribute("aria-expanded", String(!collapsed));
      brandToggle.title = label;
    }
    if (announce && brandToggle) {
      // Move focus to the brand so keyboard users keep their place.
      brandToggle.focus({ preventScroll: true });
    }
  }

  // The brand is the primary collapse control: clicking it slides the
  // sidebar away so the page content takes the full width.
  brandToggle?.addEventListener("click", () => {
    if (isMobile()) {
      closeDrawer();
      return;
    }
    setCollapsed(!collapsed);
  });

  // The header hamburger mirrors the brand on desktop and opens the
  // drawer on mobile.
  menuToggle?.addEventListener("click", () => {
    if (isMobile()) {
      const open = sidebar?.classList.toggle("mobile-open") ?? false;
      backdrop?.classList.toggle("open", open);
      menuToggle.setAttribute("aria-expanded", String(open));
    } else {
      setCollapsed(!collapsed, false);
    }
  });

  backdrop?.addEventListener("click", closeDrawer);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrawer();
  });

  window.addEventListener("resize", () => {
    if (!isMobile()) closeDrawer();
  });

  // --- Account menu ---
  const chip = document.getElementById("user-chip");
  if (chip) {
    // Build the menu first, then hand it to the Dropdown so the component
    // owns the wrapper and positioning stays anchored to the chip.
    const menu = document.createElement("div");
    menu.className = "dropdown-menu align-end";
    menu.setAttribute("role", "menu");
    menu.innerHTML = `
      <div class="dropdown-label">Account</div>
      <a class="dropdown-item" href="/settings" role="menuitem">
        <span>Settings &amp; preferences</span>
      </a>
      <a class="dropdown-item" href="/settings#data" role="menuitem">
        <span>Export &amp; backup</span>
      </a>
      <div class="dropdown-divider"></div>
      <button class="dropdown-item" id="sign-out" role="menuitem" style="color:var(--error-text);">
        <span>Sign out</span>
      </button>
    `;

    const instance = new Dropdown({
      trigger: chip,
      items: [],
      ariaLabel: "Account menu",
    });
    // The chip fills the sidebar footer, so the wrapper must be block-level
    // (an inline-block wrapper would shrink-wrap to the trigger's content).
    instance.wrapper.classList.add("dropdown-block");
    // Replace the component's placeholder menu with our own markup.
    instance.menu.remove();
    instance.menu = menu;
    instance.wrapper.appendChild(menu);
    menu.style.minWidth = "220px";
    menu.style.bottom = "calc(100% + 8px)";
    menu.style.top = "auto";
    menu.style.transformOrigin = "bottom right";

    // The account menu opens upward from the bottom of the sidebar.
    instance.open = function () {
      if (this.isOpen) return;
      this.isOpen = true;
      this.trigger.setAttribute("aria-expanded", "true");
      this.menu.classList.add("open", "drop-up");
      document.addEventListener("keydown", this.onEscClose, true);
    };
    instance.close = function () {
      if (!this.isOpen) return;
      this.isOpen = false;
      this.trigger.setAttribute("aria-expanded", "false");
      this.menu.classList.remove("open");
      document.removeEventListener("keydown", this.onEscClose, true);
    };
    instance.bindEvents();

    menu.querySelector("#sign-out")?.addEventListener("click", async () => {
      try {
        await api.logout();
        window.location.href = "/";
      } catch (err) {
        showToast("Could not sign out. Please try again.", "error");
      }
    });
  }

  // --- Load and render the signed-in user ---
  loadCurrentUser();
}

async function loadCurrentUser() {
  const nameEl = document.getElementById("user-name");
  const emailEl = document.getElementById("user-email");
  const avatarEl = document.getElementById("user-avatar");
  if (!nameEl && !emailEl) return;

  try {
    const res = await api.getCurrentUser();
    if (!res || !res.data) {
      window.location.href = "/login?next=" + encodeURIComponent(window.location.pathname);
      return;
    }
    nameEl.textContent = res.data.name;
    emailEl.textContent = res.data.email;
    avatarEl.textContent = initials(res.data.name);
    document.dispatchEvent(new CustomEvent("careerflow:user", { detail: res.data }));
  } catch (err) {
    window.location.href = "/login?next=" + encodeURIComponent(window.location.pathname);
  }
}
