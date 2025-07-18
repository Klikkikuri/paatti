"use strict";

///////////////////////////////////////////////////////////////////////////////
// Helper procedures and definitions.
///////////////////////////////////////////////////////////////////////////////

/**
 * Store the different views' IDs here in order to make making changes a bit
 * flexibler.
 */
const _viewSelectors = {
    "main":
        [".pagedashboardview", ".bottom-navi"],
    "feedback":
        [".feedbackview-controls-header", ".feedbackview-controls", ".sub-view-bottom-navi"],
    "settings":
        [".settingsview-header", ".settingsview", ".sub-view-bottom-navi"],
};

const _setCheckBoxReadonly = (checkbox, makeReadonly) => {
    if (makeReadonly) {
        checkbox.classList.add("toggle-readonly");
    } else {
        checkbox.classList.remove("toggle-readonly");
    }
};

/* Set the visual readonly state of checkboxes under settings */
const _setSettingsviewCheckboxesReadonly = (isConversionEnabled) => {
    const checkboxes = document.querySelectorAll(".settingsview .conversion-switch");
    const makeReadonly = !isConversionEnabled;
    for (const cb of checkboxes) {
        _setCheckBoxReadonly(cb, makeReadonly);
    }
};

/**
 * Update the error with the given message or reset and hide error if it evaluates to false.
 */
const _updateError = (msg) => {
    const errorElem = document.querySelector("#dashboardview-error");
    const errorElemMessageField = errorElem.querySelector("p");

    if (msg) {
        errorElem.classList.remove("hidden");
        errorElemMessageField.textContent = msg;
    } else {
        errorElem.classList.add("hidden");
        errorElemMessageField.textContent = "Tuntematon virhe.";
    }
};

const _refreshStatistics = ({ site, data }) => {
    _updateError();
    document.getElementById("site-host").textContent = site;

    if (data) {
        document.querySelector(".pagedashboardview div").classList.remove("hidden");
        document.getElementById("statistics-main-header").textContent = data["titles"]["pageClickbaitsCount"] ?? 0;
        document.getElementById("statistics-links").textContent = data["misc"]["linksCount"];
    } else {
        document.querySelector(".pagedashboardview div").classList.add("hidden");
        _updateError("Sivun tietoja ei saatu ladattua. Koeta päivittää ikkuna.");
    }
};

const _refreshSettingsView = (isConversionEnabled, sitesEnabled) => {
    // Visualize per site switches as "readonly" as per main switch state.
    _setSettingsviewCheckboxesReadonly(isConversionEnabled);

    // Set the per site switches enabled as per their switch state.
    for (const [hostname, isEnabled] of Object.entries(sitesEnabled)) {
        document.getElementById(CONFIG_KEYS_TO_SWITCHES[hostname]).checked = isEnabled;
    }
};

const _refreshPageDashboardView = async ({ pageHostname, pageStatistics, isEnabled, isKerran }) => {
    _refreshStatistics({ site: pageHostname, data: pageStatistics });

    document.getElementById("extension-disabled-temporarily").checked = isKerran;
    // The isEnabled performs a sort of double-duty, so need to check for kerran
    // here also.
    document.getElementById("shortcut-extension-enabled-current-site").checked = !(isKerran || isEnabled);
};

///////////////////////////////////////////////////////////////////////////////
// Adapters that use the controller but also trigger other business logic
// procedures.
///////////////////////////////////////////////////////////////////////////////

const handleClickMainSwitch = async (e) => {
    await controller.setEnabled(e.target.checked);
};

const handleClickConversionSwitch = async (e) => {
    // Update the persistent settings.
    const hostname = SWITCHES_TO_CONFIG_KEYS[e.target.id];
    if (hostname === undefined) {
        log("Conversion switch handler registered to unknown hostname:", hostname);
        return;
    }

    await controller.setSiteEnabled(e.target.checked, hostname);
};

const handleClickKerran = async (e) => {
    await controller.setCurrentTabKerran(e.target.checked)
};

const handleClickAina = async (e) => {
    await controller.setCurrentTabEnabled(!e.target.checked);
};

/**
 * Show this and hide other of the views.
 * @param {*} viewName Identifier of the view to show.
 */
const showView = (viewName) => {
    log(`Showing view '${viewName}'`);

    // Hide all views.
    for (const name of Object.keys(_viewSelectors)) {
        for (const elemSelector of _viewSelectors[name]) {
            document.querySelector(elemSelector).classList.add("hidden");
        }
    }
    // Show the selected view.
    for (const elemSelector of _viewSelectors[viewName]) {
        document.querySelector(elemSelector).classList.remove("hidden");
    }
};

/**
 * Load up current settings to UI.
 */
const refresh = async () => {
    const isConversionEnabled = await model.read.isEnabled();
    const pageHostname = await getCurrentTabHostname();
    const pageStatistics = await model.read.getStatistics(pageHostname);
    const sitesEnabled = await model.read.getSitesEnabled();
    const isKerran = await model.read.isKerran(pageHostname);

    // Update the power button.
    document.getElementById("extension-enabled").checked = isConversionEnabled;

    _refreshSettingsView(isConversionEnabled, sitesEnabled);
    _refreshPageDashboardView({
        pageHostname,
        pageStatistics,
        isEnabled: sitesEnabled[pageHostname],
        isKerran,
    });
};

/**
 * Perform initialization when the popup is opened. Load in settings and current
 * page's statistics.
 * @param {*} e 
 */
const handleDomContentLoaded = async (e) => {
    log("Setting up UI");

    // Initialize the global hostname variable as that's how the Javascript
    // cookie seems to crumble.
    await setGlobalCurrentTabHostname();

    await refresh();

    // Set view height to the dimensions found when opened the popup so that the
    // view does not jump around when navigating but keeps (I hope) the view
    // responsive in different windows.
    // FIXME: If height is not "max" at start (like an error message makes the
    // vertical length shorter than the length in normal state), the following
    // normal state gets a vertical scrollbar. Maybe take max of current and run
    // this again on refreshes?
    document.querySelector("body").style.height = `${document.querySelector("body").clientHeight + 38}px`;
}


/**
 * Namespace for _controller_ of model-view-controller.
 */
const view = {
    handleDomContentLoaded: handleDomContentLoaded,
    showView: showView,
    handleClickMainSwitch: handleClickMainSwitch,
    handleClickKerran: handleClickKerran,
    handleClickAina: handleClickAina,
    handleClickConversionSwitch: handleClickConversionSwitch,
    refresh: refresh,
};

///////////////////////////////////////////////////////////////////////////////
// "We have events at home."
///////////////////////////////////////////////////////////////////////////////

model.events.addEventListener(modelEvents.enabledChange, view.refresh);
model.events.addEventListener(modelEvents.kerranChange, view.refresh);
model.events.addEventListener(modelEvents.statisticsChange, view.refresh);