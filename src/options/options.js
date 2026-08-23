import { getConfig } from '../config.js';
import browser from '../browser-api.js';
import { displayProductInfo, getBrowserInfo, formatIsoWithTimezone, localizeDocument } from './utils.js';
import { model } from '../model.js';
import { controller } from '../controller.js';
import { NON_OSS_CREDIT_HTML } from './non-oss-info.js';
import { specialDayMessageKey } from './easter-egg.js';
import './components/site-list-setting.js';
import './components/visual-highlight-setting.js';
import './components/master-switch-setting.js';
import './components/title-modifier-setting.js';
import './components/database-status-setting.js';
import './components/clickbait-level-vertical.js';
import './components/favicon-img.js';
import './components/page-background.js';
import './components/easter-egg-setting.js';

// Load settings on page load
document.addEventListener('DOMContentLoaded', async () => {
    localizeDocument();
    await loadSettings();
    displayProductInfo();
    setupEventListeners();
    await renderAbout();
});

async function loadSettings() {
    try {
        const config = await getConfig();
        
        // Extension enabled state is managed by the master-switch-setting component

        // Environment
        const envRadio = document.querySelector(`input[value="${config.activeEnv || 'free'}"]`);
        if (envRadio) {
            envRadio.checked = true;
            document.querySelectorAll('.env-option').forEach(opt => opt.classList.remove('selected'));
            document.querySelector(`label[data-env="${config.activeEnv || 'free'}"]`).classList.add('selected');
        }
        
        // Show/hide debug settings based on environment
        toggleDebugSettings(config.activeEnv || 'free');
        
        // Refresh interval is managed by the database-status-setting component
        
        // Debug visuals is managed by the visual-highlight-setting component

        // Modifier toggle state is managed by the title-modifier-setting component

        // Clickbait level is managed by the clickbait-level-vertical component
        
        // Load saved email for paid environment
        let savedEmail = '';
        try {
            savedEmail = config.environmentConfigs.paid.email || '';
            console.log('Loaded saved email:', config.environmentConfigs.paid);
        } catch (e) {
            savedEmail = '';
        }
        const emailInput = document.getElementById('invitationEmail');
        if (emailInput && document.activeElement !== emailInput) {
            emailInput.value = savedEmail;
        }

        // Load saved titleDataUrls for development environment
        let devUrls = [];
        try {
            devUrls = config.environmentConfigs.development.titleDataUrls || [];
        } catch (e) {
            devUrls = [];
        }
        const devUrlsTextarea = document.getElementById('devTitleDataUrls');
        if (devUrlsTextarea && document.activeElement !== devUrlsTextarea) {
            devUrlsTextarea.value = devUrls.join('\n');
        }

        // Site configurations are managed by the site-list-setting component

        // Database status is managed by the database-status-setting component
    } catch (error) {
        console.error('Error loading settings:', error);
        showStatus(browser.i18n.getMessage('optionsErrorLoadingSettings') || 'Error loading settings', true);
    }
}

// refreshDatabaseStatus is now encapsulated in the database-status-setting component


function showStatus(message, isError = false) {
    const statusEl = document.getElementById('statusMessage');
    statusEl.textContent = message;
    statusEl.className = 'status-message show' + (isError ? ' error' : '');
    
    setTimeout(() => {
        statusEl.classList.remove('show');
    }, 3000);
}




function toggleDebugSettings(environment) {
    const debugSettings = document.getElementById('debug-settings');
    const invitationSection = document.getElementById('invitation-section');
    
    if (environment === 'development') {
        debugSettings.classList.add('visible');
    } else {
        debugSettings.classList.remove('visible');
    }
    
    if (environment === 'paid') {
        invitationSection.classList.add('visible');
    } else {
        invitationSection.classList.remove('visible');
    }
}

async function registerEmail() {

    const emailInput = document.getElementById('invitationEmail');
    const submitButton = document.getElementById('submitInvitation');
    const email = emailInput.value.trim();
    if (!email) {
        showStatus(browser.i18n.getMessage('invitationEmailRequired') || 'Please enter an email address', true);
        return;
    }
    
    // Disable button during submission
    const originalText = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = browser.i18n.getMessage('invitationEmailSending') || 'Sending...';
    
    // Placeholder function to simulate email registration
    const action = "https://docs.google.com/forms/d/e/1FAIpQLSf0m5X_EKJume6oSbz5o36CmOVofsNy8F8AjrwOLQ4Tm4B_8g/formResponse";
    const formData = new FormData();
    formData.append('emailAddress', email);
    formData.append('pageHistory', '0');
    formData.append('submissionTimestamp', Date.now().toString());

    try {
        await fetch(action, {
            method: 'POST',
            mode: 'no-cors',
            referrerPolicy: 'no-referrer',
            credentials: 'omit',
            body: formData
        });
        
        // Store email in sync settings
        await model.write.setEmail(email, 'paid');
        
        // Show success state on button
        submitButton.textContent = browser.i18n.getMessage('invitationEmailSent') || '✓ Sent';
        submitButton.classList.add('success');
        showStatus(browser.i18n.getMessage('invitationEmailSuccess') || 'Email registered successfully!');

        // Reset button after fade completes
        setTimeout(() => {
            submitButton.textContent = originalText;
            submitButton.classList.remove('success');
            submitButton.disabled = false;
        }, 3300);
    } catch (error) {
        console.error('Error registering email:', error);
        showStatus(browser.i18n.getMessage('invitationEmailError') || 'Error registering email', true);

        // Reset button on error
        submitButton.textContent = originalText;
        submitButton.disabled = false;
    }
}


async function setupEventListeners() {

    // Extension enabled toggle is managed by the master-switch-setting component

    // Clickbait level slider and labels are managed by the clickbait-level-vertical component
    // AI Slop toggle is managed by the title-modifier-setting component

    // Site list toggled events
    document.getElementById('siteList').addEventListener('site-toggled', (e) => {
        const { success, message } = e.detail;
        showStatus(message, !success);
    });

    // Environment selection
    document.querySelectorAll('input[name="environment"]').forEach(radio => {
        radio.addEventListener('change', async (e) => {
            const val = e.target.value;
            document.querySelectorAll('.env-option').forEach(opt => opt.classList.remove('selected'));
            e.target.closest('.env-option').classList.add('selected');
            toggleDebugSettings(val);
            try {
                await controller.setEnvironment(val);
                showStatus(browser.i18n.getMessage('envSavedSuccess') || 'Environment saved!');
            } catch (error) {
                console.error('Error saving environment:', error);
                showStatus(browser.i18n.getMessage('envSavedError') || 'Error saving environment', true);
            }
        });
    });
    
    document.getElementById('submitInvitation').addEventListener('click', registerEmail);
    
    // Monitor email input changes to enable/disable submit button
    document.getElementById('invitationEmail').addEventListener('input', (e) => {
        const submitButton = document.getElementById('submitInvitation');
        const currentEmail = e.target.value.trim();
        
        // Disable button if email is empty or not valid
        if (currentEmail === '' || e.target.validity.typeMismatch) {
            submitButton.disabled = true;
        } else {
            submitButton.disabled = false;
        }
    });
    
    // Handle Enter key on email input
    document.getElementById('invitationEmail').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            registerEmail();
        }
    });
    // Debug visuals toggle is handled by the visual-highlight-setting component.
    // Listen to custom setting-saved events dispatched from components.
    document.addEventListener('setting-saved', (e) => {
        const { success, message } = e.detail;
        showStatus(message, !success);
    });

    // Refresh interval is handled by the database-status-setting component

    // Save development URLs button
    const saveDevUrlsBtn = document.getElementById('saveDevUrlsBtn');
    if (saveDevUrlsBtn) {
        saveDevUrlsBtn.addEventListener('click', async () => {
            const devUrlsTextarea = document.getElementById('devTitleDataUrls');
            if (devUrlsTextarea) {
                const urls = devUrlsTextarea.value
                    .split('\n')
                    .map(u => u.trim())
                    .filter(u => u.length > 0);
                
                // Validate URLs
                for (const url of urls) {
                    try {
                        new URL(url);
                    } catch (e) {
                        const errMsg = browser.i18n.getMessage('devUrlsInvalid', [url]) || `Invalid development URL: ${url}`;
                        showStatus(errMsg, true);
                        return;
                    }
                }
                
                try {
                    await controller.setDevTitleDataUrls(urls);
                    showStatus(browser.i18n.getMessage('devUrlsSavedSuccess') || 'Development URLs saved!');
                } catch (error) {
                    console.error('Error saving dev URLs:', error);
                    showStatus(browser.i18n.getMessage('devUrlsSavedError') || 'Error saving development URLs', true);
                }
            }
        });
    }

    // Manual database update button is handled by the database-status-setting component
}

// Keep options page synchronized with settings changes from other parts of the extension (e.g. popup)
browser.storage.onChanged.addListener(async (changes, area) => {
    console.log("Storage changed, reloading settings in options page");
    await loadSettings();
    await renderAbout();
});

/**
 * Sets the text content of an about-info field by element ID.
 * Silently no-ops if the element is not found.
 * @param {string} id - Element ID
 * @param {string} value - Text to display
 */
function setAboutField(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

/**
 * Tags an about line may keep: a link, and the inline emphasis a translator may
 * reasonably reach for. Anything outside the list is unwrapped rather than dropped,
 * so an unexpected tag costs the markup and never the sentence.
 */
const ABOUT_TAGS = new Set(['A', 'B', 'STRONG', 'I', 'EM', 'CODE', 'SPAN', 'BR']);

/** Tags whose text is code, not prose: unwrapping these would print the code. */
const ABOUT_DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);

/**
 * Strips an about line down to text and the few tags in ABOUT_TAGS.
 *
 * Today's callers pass a bundled locale string or the build overlay, so there is
 * nothing hostile to strip. The point is the next caller: a locale file is edited
 * by translators and the overlay by whoever cuts the non-OSS build, and neither
 * should be able to put an <img> beacon, an event handler or a javascript: link on
 * the options page by accident. Attributes go entirely -- an <a> is given back the
 * only three it needs.
 *
 * @param {DocumentFragment|HTMLElement} root - Parsed markup, edited in place.
 */
function sanitizeAbout(root) {
    for (const el of [...root.querySelectorAll('*')]) {
        // A parent may already have taken this node out of the tree.
        if (!root.contains(el)) continue;

        if (ABOUT_DROP_TAGS.has(el.tagName)) {
            el.remove();
            continue;
        }

        const href = el.tagName === 'A' ? el.getAttribute('href') : null;
        for (const name of [...el.getAttributeNames()]) el.removeAttribute(name);

        if (!ABOUT_TAGS.has(el.tagName)) {
            el.replaceWith(...el.childNodes);
            continue;
        }

        // The anchor resolves its own href, so .protocol is what the link would really
        // open -- a relative or protocol-relative href is judged on that, and one that
        // does not parse at all reports an empty protocol rather than throwing. The
        // href goes back as written, because normalizing would percent-encode the
        // non-ASCII paths some locales link to.
        if (el.tagName !== 'A') continue;
        el.setAttribute('href', href ?? '');
        if (el.protocol === 'https:' || el.protocol === 'http:') {
            el.setAttribute('target', '_blank');
            el.setAttribute('rel', 'noopener noreferrer');
        } else {
            el.replaceWith(...el.childNodes);
        }
    }
}

/**
 * Replaces the content of an about field with parsed markup.
 * For the few fields whose text may carry a link; runtime values use setAboutField.
 * @param {string} id - Element ID
 * @param {string} html - Markup to show; sanitized by sanitizeAbout before insertion
 */
function setAboutHtml(id, html) {
    const el = document.getElementById(id);
    if (!el) return;

    const doc = new DOMParser().parseFromString(html, 'text/html');
    sanitizeAbout(doc.body);

    // renderAbout() runs again on every storage change, so replace rather than
    // append: appending would stack a second copy of the line each time.
    el.replaceChildren(...doc.body.childNodes);
}


/**
 * Populates the About section with runtime and config info useful for issue reports.
 * Gathers data from manifest, config, model, and navigator.
 */
async function renderAbout() {
    const manifest = browser.runtime.getManifest();
    const config = await getConfig();
    const status = await model.read.getDatabaseStatus();

    // Version
    setAboutField('about-version', manifest.version);

    // Environment
    setAboutField('about-env', config.activeEnv || 'free');

    // Browser — native APIs
    setAboutField('about-browser', await getBrowserInfo());

    // OS — prefer userAgentData (Chromium), fall back to navigator.platform
    const platform = navigator.userAgentData?.platform || navigator.platform || '—';
    const arch = navigator.userAgentData?.architecture || '';
    setAboutField('about-os', arch ? `${platform} ${arch}` : platform);

    // Last DB fetch
    setAboutField('about-db-update', formatIsoWithTimezone(status.lastDatabaseUpdate));

    // DB generation date
    setAboutField('about-db-gen', formatIsoWithTimezone(status.databaseGenerationDate));

    // Clickbait level
    const clickbaitLevel = config.clickbaitLevel !== undefined ? config.clickbaitLevel : 2;
    setAboutField('about-clickbait-level', `${clickbaitLevel}`);

    // Active modifiers — list names of enabled modifiers
    const modifiers = config.modifiers || {};
    const activeModifiers = Object.entries(modifiers)
        .filter(([, enabled]) => enabled)
        .map(([name]) => name);
    const noneText = browser.i18n.getMessage('aboutNone') || 'none';
    setAboutField('about-modifiers', activeModifiers.length ? activeModifiers.join(', ') : noneText);

    // Enabled sites — if global toggle is off, show that instead of listing sites
    if (!config.enabled) {
        setAboutField('about-sites', browser.i18n.getMessage('aboutExtensionDisabled') || 'extension disabled');
    } else {
        const sitesEnabled = await model.read.getSitesEnabled();
        const enabledSites = Object.entries(sitesEnabled)
            .filter(([, enabled]) => enabled)
            .map(([domain]) => domain);
        setAboutField('about-sites', enabledSites.length ? enabledSites.join(', ') : noneText);
    }

    // Today — a line on the days the easter egg calendar marks, hidden on the rest
    const specialDay = document.getElementById('special-day');
    const specialDayKey = specialDayMessageKey(new Date());
    if (specialDay) {
        if (specialDayKey) setAboutHtml('special-day-reason', browser.i18n.getMessage(specialDayKey));
        specialDay.classList.toggle('visible', Boolean(specialDayKey));
    }

    // Non-OSS credit (empty string in OSS builds -> no visible output)
    if (NON_OSS_CREDIT_HTML) {
        setAboutHtml('non-oss-credit', NON_OSS_CREDIT_HTML);
    }
}

