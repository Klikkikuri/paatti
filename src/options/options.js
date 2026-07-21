import { getConfig } from '../config.js';
import { browser } from '../utils.js';
import { isSiteEnabled, displayProductInfo } from './utils.js';
import { model } from '../model.js';
import { controller } from '../controller.js';

// Load settings on page load
document.addEventListener('DOMContentLoaded', async () => {
    await loadSettings();
    displayProductInfo();
    setupEventListeners();
});

async function loadSettings() {
    try {
        const config = await getConfig();
        
        // Extension enabled
        document.getElementById('extensionEnabled').checked = config.enabled || false;

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
        document.getElementById('refreshInterval').value = config.refreshIntervalMinutes || 20;
        
        // Debug visuals
        document.getElementById('debugVisuals').checked = config.debugVisualsEnabled || false;

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
        emailInput.value = savedEmail;

        // Load saved titleDataUrls for development environment
        let devUrls = [];
        try {
            devUrls = config.environmentConfigs.development.titleDataUrls || [];
        } catch (e) {
            devUrls = [];
        }
        const devUrlsTextarea = document.getElementById('devTitleDataUrls');
        if (devUrlsTextarea) {
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
        const data = await browser().storage.local.get(["lastDatabaseUpdate", "databaseGenerationDate"]);
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
        const siteItem = document.createElement('div');
        siteItem.className = 'site-item';

        const enabled = await isSiteEnabled(domain);
        console.log(`Rendering site ${domain} with enabled: ${enabled}`);

        const faviconUrl = `https://icons.duckduckgo.com/ip3/${domain}.ico`;

        const siteInfo = document.createElement('div');
        siteInfo.className = 'site-info';

        const faviconImg = document.createElement('img');
        faviconImg.src = faviconUrl;
        faviconImg.alt = '';
        faviconImg.width = 24;
        faviconImg.height = 24;
        faviconImg.className = 'site-favicon';
        siteInfo.appendChild(faviconImg);

        const textContainer = document.createElement('div');

        const siteName = document.createElement('div');
        siteName.className = 'site-name';
        siteName.textContent = config.name || domain;
        textContainer.appendChild(siteName);

        const siteDomain = document.createElement('div');
        siteDomain.className = 'site-domain';
        siteDomain.textContent = domain;
        textContainer.appendChild(siteDomain);

        siteInfo.appendChild(textContainer);
        siteItem.appendChild(siteInfo);

        const toggleSwitch = document.createElement('label');
        toggleSwitch.className = 'toggle-switch';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `site-${domain}`;
        checkbox.dataset.site = domain;
        checkbox.checked = enabled;

        const origins = config.origins || [`https://${domain}/*`];
        checkbox.dataset.origins = JSON.stringify(origins);
        const hasPermission = origins.length > 0 ? await browser().permissions.contains({ origins }) : false;
        checkbox.dataset.hasPermission = String(hasPermission);

        toggleSwitch.appendChild(checkbox);

        const toggleSlider = document.createElement('span');
        toggleSlider.className = 'toggle-slider';
        toggleSwitch.appendChild(toggleSlider);

        siteItem.appendChild(toggleSwitch);
        siteList.appendChild(siteItem);
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

    // Site list checkboxes
    document.getElementById('siteList').addEventListener('change', async (e) => {
        if (e.target && e.target.type === 'checkbox') {
            const checked = e.target.checked;
            const domain = e.target.dataset.site;
            const hasPermission = e.target.dataset.hasPermission === "true";
            
            let origins = [];
            try {
                origins = JSON.parse(e.target.dataset.origins || "[]");
            } catch (err) {
                console.error("Error parsing origins dataset:", err);
            }

            if (checked && origins.length > 0) {
                if (hasPermission) {
                    try {
                        await controller.setSiteEnabled(true, domain);
                        showStatus(`Sivuston ${domain} asetus tallennettu!`);
                    } catch (error) {
                        showStatus('Virhe tallennettaessa sivuston asetusta', true);
                        e.target.checked = false;
                    }
                } else {
                    console.log(`Requesting permission for ${domain}`);
                    try {
                        const granted = await browser().permissions.request({ origins });
                        if (granted) {
                            await controller.setSiteEnabled(true, domain);
                            e.target.dataset.hasPermission = "true";
                            showStatus(`Sivuston ${domain} asetus tallennettu!`);
                        } else {
                            e.target.checked = false;
                            console.warn(`Permission denied for ${domain}`);
                        }
                    } catch (error) {
                        showStatus('Virhe pyydettäessä lupaa', true);
                        console.error('Error requesting permission:', error);
                        e.target.checked = false;
                    }
                }
            } else {
                try {
                    await controller.setSiteEnabled(false, domain);
                    showStatus(`Sivuston ${domain} asetus tallennettu!`);
                } catch (error) {
                    showStatus('Virhe tallennettaessa sivuston asetusta', true);
                    e.target.checked = true;
                }
            }
        }
    });

    // Environment selection
    document.querySelectorAll('input[name="environment"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            document.querySelectorAll('.env-option').forEach(opt => opt.classList.remove('selected'));
            e.target.closest('.env-option').classList.add('selected');
            toggleDebugSettings(e.target.value);
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

    // Save button
    document.getElementById('saveBtn').addEventListener('click', saveSettings);
    
    // Reset button
    document.getElementById('resetBtn').addEventListener('click', resetSettings);

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



async function saveSettings() {
    try {
        const extensionEnabled = document.getElementById('extensionEnabled').checked;
        const clickbaitLevel = parseInt(document.getElementById('clickbaitLevel').value);
        const environment = document.querySelector('input[name="environment"]:checked')?.value || 'free';
        const refreshIntervalMinutes = parseInt(document.getElementById('refreshInterval').value);
        const debugVisualsEnabled = document.getElementById('debugVisuals').checked;
        
        // Collect site overrides correctly matching the userSiteOverrides structure: { [domain]: { enabled: boolean } }
        const syncData = await browser().storage.sync.get("userSiteOverrides");
        const siteOverrides = syncData.userSiteOverrides || {};
        document.querySelectorAll('#siteList input[type="checkbox"]').forEach(checkbox => {
            const domain = checkbox.dataset.site;
            siteOverrides[domain] = siteOverrides[domain] || {};
            siteOverrides[domain].enabled = checkbox.checked;
        });
        
        // Save userPreferences safely merging other fields like environmentConfigs
        const data = await browser().storage.local.get("userPreferences");
        const userPreferences = data.userPreferences || {};
        userPreferences.enabled = extensionEnabled;
        userPreferences.clickbaitLevel = clickbaitLevel;
        userPreferences.environment = environment;
        userPreferences.refreshIntervalMinutes = refreshIntervalMinutes;
        userPreferences.debugVisualsEnabled = debugVisualsEnabled;

        // Save titleDataUrls for development environment
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
            
            if (!userPreferences.environmentConfigs) {
                userPreferences.environmentConfigs = {};
            }
            if (!userPreferences.environmentConfigs.development) {
                userPreferences.environmentConfigs.development = {};
            }
            userPreferences.environmentConfigs.development.titleDataUrls = urls;
        }

        await browser().storage.local.set({ userPreferences });
        await browser().storage.sync.set({ userSiteOverrides: siteOverrides });
        
        showStatus('Asetukset tallennettu!');
    } catch (error) {
        console.error('Error saving settings:', error);
        showStatus('Virhe asetusten tallentamisessa', true);
    }
}


async function resetSettings() {
    if (confirm('Haluatko varmasti palauttaa kaikki asetukset oletusarvoihin?')) {
        try {
            await browser().storage.local.remove('userPreferences');
            await browser().storage.sync.remove('userSiteOverrides');
            await loadSettings();
            showStatus('Asetukset palautettu!');
        } catch (error) {
            console.error('Error resetting settings:', error);
            showStatus('Virhe asetusten palauttamisessa', true);
        }
    }
}

// Keep options page synchronized with settings changes from other parts of the extension (e.g. popup)
browser().storage.onChanged.addListener(async (changes, area) => {
    console.log("Storage changed, reloading settings in options page");
    await loadSettings();
});
