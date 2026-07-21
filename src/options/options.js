import { getConfig } from '../config.js';
import { browser } from '../utils.js';
import { displayProductInfo } from './utils.js';
import { model } from '../model.js';
import { controller } from '../controller.js';
import './components/site-toggle.js';
import './components/visual-highlight-setting.js';
import './components/master-switch-setting.js';
import './components/title-modifier-setting.js';

// Load settings on page load
document.addEventListener('DOMContentLoaded', async () => {
    await loadSettings();
    displayProductInfo();
    setupEventListeners();
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
        
        // Refresh interval
        const refreshIntervalEl = document.getElementById('refreshInterval');
        if (refreshIntervalEl && document.activeElement !== refreshIntervalEl) {
            refreshIntervalEl.value = config.refreshIntervalMinutes || 20;
        }
        
        // Debug visuals is managed by the visual-highlight-setting component

        // Modifier toggle state is managed by the title-modifier-setting component

        // Clickbait level
        document.getElementById('clickbaitLevel').value = config.clickbaitLevel !== undefined ? config.clickbaitLevel : 2;
        
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

        // Site configurations
        renderSiteList(config.siteConfigs || {});

        // Load database status
        await refreshDatabaseStatus();
    } catch (error) {
        console.error('Error loading settings:', error);
        showStatus('Virhe asetusten lataamisessa', true);
    }
}

async function refreshDatabaseStatus() {
    try {
        const data = await model.read.getDatabaseStatus();
        const dbLastUpdatedText = document.getElementById("dbLastUpdatedText");
        if (dbLastUpdatedText) {
            if (data.lastDatabaseUpdate) {
                const date = new Date(data.lastDatabaseUpdate);
                dbLastUpdatedText.textContent = date.toLocaleString("fi-FI");
            } else {
                dbLastUpdatedText.textContent = "Ei koskaan";
            }
        }
        const dbGenerationDateText = document.getElementById("dbGenerationDateText");
        if (dbGenerationDateText) {
            if (data.databaseGenerationDate) {
                const date = new Date(data.databaseGenerationDate);
                dbGenerationDateText.textContent = date.toLocaleString("fi-FI");
            } else {
                dbGenerationDateText.textContent = "Tuntematon";
            }
        }
    } catch (error) {
        console.error("Error loading database status:", error);
    }
}


function showStatus(message, isError = false) {
    const statusEl = document.getElementById('statusMessage');
    statusEl.textContent = message;
    statusEl.className = 'status-message show' + (isError ? ' error' : '');
    
    setTimeout(() => {
        statusEl.classList.remove('show');
    }, 3000);
}


async function renderSiteList(siteConfigs) {
    const siteList = document.getElementById('siteList');
    siteList.innerHTML = '';
    
    for (const [domain, config] of Object.entries(siteConfigs)) {
        const siteToggle = document.createElement('site-toggle-setting');
        siteToggle.setAttribute('domain', domain);
        siteToggle.setAttribute('name', config.name || domain);
        siteToggle.setAttribute('origins', JSON.stringify(config.origins || [`https://${domain}/*`]));
        
        siteList.appendChild(siteToggle);
    }
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

    // Clickbait level slider
    const clickbaitSlider = document.getElementById('clickbaitLevel');
    if (clickbaitSlider) {
        clickbaitSlider.addEventListener('change', async () => {
            const value = parseInt(clickbaitSlider.value);
            if (!isNaN(value)) {
                await controller.setClickbaitLevel(value);
                showStatus('Asetus tallennettu!');
            }
        });
    }

    // AI Slop toggle is managed by the title-modifier-setting component
    
    // Make slider labels clickable
    document.querySelectorAll('.slider-labels label').forEach(label => {
        label.addEventListener('click', async (e) => {
            e.preventDefault(); // Prevent browser default focusing to avoid double events
            const value = parseInt(label.dataset.value);
            if (!isNaN(value) && clickbaitSlider) {
                clickbaitSlider.value = value;
                await controller.setClickbaitLevel(value);
                showStatus('Asetus tallennettu!');
            }
        });
    });

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

    // Refresh interval
    const refreshIntervalInput = document.getElementById('refreshInterval');
    if (refreshIntervalInput) {
        refreshIntervalInput.addEventListener('change', async () => {
            const value = parseInt(refreshIntervalInput.value);
            if (!isNaN(value) && value >= 1) {
                try {
                    await controller.setRefreshIntervalMinutes(value);
                    showStatus('Päivitysväli tallennettu!');
                } catch (error) {
                    console.error('Error saving refresh interval:', error);
                    showStatus('Virhe tallennettaessa päivitysväliä', true);
                }
            } else {
                showStatus('Virheellinen päivitysväli!', true);
            }
        });
    }

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

    // Manual database update button
    const manualUpdateBtn = document.getElementById('manualUpdateBtn');
    if (manualUpdateBtn) {
        manualUpdateBtn.addEventListener('click', async () => {
            manualUpdateBtn.disabled = true;
            const originalText = manualUpdateBtn.textContent;
            manualUpdateBtn.textContent = 'Päivitetään...';
            
            try {
                const response = await browser().runtime.sendMessage({ action: "updateDatabase" });
                if (response && response.success) {
                    showStatus('Tietokanta päivitetty onnistuneesti!');
                    await refreshDatabaseStatus();
                } else {
                    showStatus('Tietokannan päivitys epäonnistui: ' + (response?.error || 'Tuntematon virhe'), true);
                }
            } catch (error) {
                console.error('Error updating database:', error);
                showStatus('Tietokannan päivitys epäonnistui', true);
            } finally {
                manualUpdateBtn.disabled = false;
                manualUpdateBtn.textContent = originalText;
            }
        });
    }
}

// Keep options page synchronized with settings changes from other parts of the extension (e.g. popup)
browser().storage.onChanged.addListener(async (changes, area) => {
    console.log("Storage changed, reloading settings in options page");
    await loadSettings();
});
