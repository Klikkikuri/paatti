import { getConfig } from '../config.js';
import { browser } from '../utils.js';
import { displayProductInfo, getBrowserInfo, formatIsoWithTimezone } from './utils.js';
import { model } from '../model.js';
import { controller } from '../controller.js';
import { NON_OSS_CREDIT_HTML } from './non-oss-info.js';
import './components/site-list-setting.js';
import './components/visual-highlight-setting.js';
import './components/master-switch-setting.js';
import './components/title-modifier-setting.js';
import './components/database-status-setting.js';
import './components/clickbait-level-vertical.js';
import './components/favicon-img.js';

// Load settings on page load
document.addEventListener('DOMContentLoaded', async () => {
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
        showStatus('Virhe asetusten lataamisessa', true);
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
        showStatus('Syötä sähköpostiosoite', true);
        return;
    }
    
    // Disable button during submission
    const originalText = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = 'Lähetetään...';
    
    // Placeholder function to simulate email registration
    const action = "https://docs.google.com/forms/d/e/1FAIpQLSf0m5X_EKJume6oSbz5o36CmOVofsNy8F8AjrwOLQ4Tm4B_8g/formResponse";
    const formData = new FormData();
    // emailAddress	"test@example.com"
    // fvv	"1"
    // partialResponse	'[null,null,"-689544841256870296"]'
    // pageHistory	"0"
    // fbzx	"-689544841256870296"
    // submissionTimestamp	"1768143435223"
    formData.append('emailAddress', email);
    formData.append('pageHistory', '0');
    formData.append('submissionTimestamp', Date.now().toString());

    try {
        const response = await fetch(action, {
            method: 'POST',
            mode: 'no-cors',
            referrerPolicy: 'no-referrer',
            credentials: 'omit',
            body: formData
        });
        
        // Store email in sync settings
        await model.write.setEmail(email, 'paid');
        
        // Show success state on button
        submitButton.textContent = '✓ Lähetetty';
        submitButton.classList.add('success');
        showStatus('Sähköposti rekisteröity onnistuneesti!');

        // Reset button after fade completes
        setTimeout(() => {
            submitButton.textContent = originalText;
            submitButton.classList.remove('success');
            submitButton.disabled = false;
        }, 3300);
    } catch (error) {
        console.error('Error registering email:', error);
        showStatus('Virhe sähköpostin rekisteröinnissä', true);

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
                showStatus('Ympäristö tallennettu!');
            } catch (error) {
                console.error('Error saving environment:', error);
                showStatus('Virhe ympäristön tallentamisessa', true);
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
                        showStatus(`Virheellinen kehitys-URL: ${url}`, true);
                        return;
                    }
                }
                
                try {
                    await controller.setDevTitleDataUrls(urls);
                    showStatus('Kehitys-URL:t tallennettu!');
                } catch (error) {
                    console.error('Error saving dev URLs:', error);
                    showStatus('Virhe tallennettaessa kehitys-URL:eja', true);
                }
            }
        });
    }

    // Manual database update button is handled by the database-status-setting component
}

// Keep options page synchronized with settings changes from other parts of the extension (e.g. popup)
browser().storage.onChanged.addListener(async (changes, area) => {
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
 * Populates the About section with runtime and config info useful for issue reports.
 * Gathers data from manifest, config, model, and navigator.
 */
async function renderAbout() {
    const manifest = browser().runtime.getManifest();
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
    setAboutField('about-modifiers', activeModifiers.length ? activeModifiers.join(', ') : 'none');

    // Enabled sites — if global toggle is off, show that instead of listing sites
    if (!config.enabled) {
        setAboutField('about-sites', 'extension disabled');
    } else {
        const sitesEnabled = await model.read.getSitesEnabled();
        const enabledSites = Object.entries(sitesEnabled)
            .filter(([, enabled]) => enabled)
            .map(([domain]) => domain);
        setAboutField('about-sites', enabledSites.length ? enabledSites.join(', ') : 'none');
    }

    // Non-OSS credit (empty string in OSS builds -> no visible output)
    const creditEl = document.getElementById('non-oss-credit');
    if (creditEl && NON_OSS_CREDIT_HTML) {
        creditEl.innerHTML = NON_OSS_CREDIT_HTML;
    }
}

