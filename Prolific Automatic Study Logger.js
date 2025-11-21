// ==UserScript==
// @name         Prolific Automatic Study Logger (Google Sheets + Shadow DOM - v2.0.1 Fix)
// @namespace    http://tampermonkey.net/
// @version      2.0.1
// @description  Log specific Prolific studies automatically to Google Sheets, hide log from extensions, and provide a collapsible UI. (Fixes researcher logging)
// @author       You
// @match        https://app.prolific.com/studies
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// @connect      script.googleusercontent.com // Sometimes needed for Apps Script redirects
// ==/UserScript==

(function() {
    'use strict';

    // ===== Configuration =====
    const targetResearchers = ["LRL Humans", "Katy", "Chibi", "Leyla Sursat", "M Research", "Maximilian Spliethover", "Soli", "Gateau", "rcbHU NUGdo","Aparna Research","Galactic Probe","Pranali Yawalkar", "Vortex Oasis","Rearview studies","Anna Luisa",];
    const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbyQ1XqNI04BopfIr3-76gJ4-Pr-0awNXuMMMBUTM2J1ih8fD9m-aveVh8JgW3ppMvbWgg/exec'; // <-- Your Web App URL

    // ===== State Variables =====
    let loggedStudies = new Map(); // Use Map to store study data (studyId -> studyData)
    let isLogVisible = true; // Default state for the log display

    // ===== DOM Elements (will be assigned in setupGUI) =====
    let guiHost = null;
    let shadowRoot = null;
    let logDiv = null;
    let toggleButton = null;

    // ===== Helper Functions =====
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    function waitForElement(selector, callback) {
        const element = document.querySelector(selector);
        if (element) {
            callback(element);
        } else {
            const observer = new MutationObserver(mutations => {
                const element = document.querySelector(selector);
                if (element) {
                    callback(element);
                    observer.disconnect();
                }
            });
            observer.observe(document.documentElement, { childList: true, subtree: true });
        }
    }

    // ===== State Persistence =====
    function loadState() {
        // Load Log Visibility State
        const savedVisibility = localStorage.getItem('prolificLogVisible');
        if (savedVisibility !== null) {
            isLogVisible = JSON.parse(savedVisibility);
        }

        // Load Logged Studies Data
        const savedLoggedStudies = localStorage.getItem('prolificLoggedStudies');
        if (savedLoggedStudies) {
            try {
                const parsedStudies = new Map(Object.entries(JSON.parse(savedLoggedStudies)));
                loggedStudies = parsedStudies;
                console.log(`Loaded ${loggedStudies.size} studies from localStorage.`);
            } catch (error) {
                console.error("Error parsing loggedStudies from localStorage:", error);
                loggedStudies = new Map();
                localStorage.removeItem('prolificLoggedStudies'); // Clear corrupted data
            }
        }
    }

    function saveState() {
        localStorage.setItem('prolificLogVisible', JSON.stringify(isLogVisible));
        // Convert Map to object for JSON serialization
        localStorage.setItem('prolificLoggedStudies', JSON.stringify(Object.fromEntries(loggedStudies)));
    }

    // ===== GUI Setup (within Shadow DOM) =====
    function setupGUI() {
        // Create the host element that will contain the shadow root
        guiHost = document.createElement('div');
        guiHost.id = 'prolific-logger-host'; // ID for the host element itself
        document.body.appendChild(guiHost);

        // Attach the shadow root
        shadowRoot = guiHost.attachShadow({ mode: 'open' });

        // Inject Styles into Shadow DOM
        const style = document.createElement('style');
        style.textContent = `
            #prolificLoggerGUI {
                position: fixed;
                top: 100px;
                right: 10px;
                background-color: white;
                border: 1px solid black;
                padding: 10px;
                z-index: 1000;
                font-family: sans-serif;
                font-size: 12px;
                min-width: 250px; /* Give it some base width */
            }
            #prolificLogDiv {
                margin-top: 5px;
                margin-bottom: 10px;
                max-height: 200px;
                overflow-y: auto;
                border: 1px solid #ccc;
                padding: 5px;
                /* Transition for smooth collapse/expand */
                transition: max-height 0.3s ease-out, padding 0.3s ease-out, border 0.3s ease-out;
            }
            #prolificLogDiv.hidden {
                max-height: 0;
                padding-top: 0;
                padding-bottom: 0;
                border-width: 0;
                overflow: hidden; /* Hide content when collapsed */
            }
            .log-entry {
                margin-bottom: 3px;
                padding-bottom: 3px;
                border-bottom: 1px dotted #eee;
            }
            .log-entry:last-child {
                 border-bottom: none;
            }
            button {
                margin-right: 5px;
                padding: 4px 8px;
                cursor: pointer;
            }
            .header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 5px;
                font-weight: bold;
            }
        `;
        shadowRoot.appendChild(style);

        // Create GUI container within Shadow DOM
        const guiContainer = document.createElement('div');
        guiContainer.id = 'prolificLoggerGUI';

        // Header with Title and Toggle Button
        const headerDiv = document.createElement('div');
        headerDiv.className = 'header';
        const titleSpan = document.createElement('span');
        titleSpan.textContent = 'Study Logger';
        toggleButton = document.createElement('button');
        toggleButton.id = 'toggleLogBtn';
        toggleButton.onclick = toggleLogVisibility;
        headerDiv.appendChild(titleSpan);
        headerDiv.appendChild(toggleButton);
        guiContainer.appendChild(headerDiv);

        // Log Display Area
        logDiv = document.createElement('div');
        logDiv.id = 'prolificLogDiv';
        guiContainer.appendChild(logDiv);

        // Buttons Area
        const buttonDiv = document.createElement('div');
        const clearLogButton = document.createElement('button');
        clearLogButton.textContent = 'Clear Local Log';
        clearLogButton.onclick = () => {
            if (confirm('Are you sure you want to clear the locally stored log? This will not delete data from Google Sheets.')) {
                loggedStudies.clear();
                logDiv.innerHTML = ''; // Clear the visual log
                saveState(); // Save the cleared state
                console.log("Local log cleared.");
            }
        };
        buttonDiv.appendChild(clearLogButton);
        guiContainer.appendChild(buttonDiv);

        // Append the main container to the shadow root
        shadowRoot.appendChild(guiContainer);

        // Initial UI state
        updateLogVisibilityUI();
        rebuildVisualLog(); // Populate log from loaded data
    }

    function toggleLogVisibility() {
        isLogVisible = !isLogVisible;
        updateLogVisibilityUI();
        saveState(); // Save the new visibility state
    }

    function updateLogVisibilityUI() {
        if (!logDiv || !toggleButton) return; // Ensure elements exist

        if (isLogVisible) {
            logDiv.classList.remove('hidden');
            toggleButton.textContent = '[-]'; // Collapse icon
            toggleButton.title = 'Hide Log';
        } else {
            logDiv.classList.add('hidden');
            toggleButton.textContent = '[+]'; // Expand icon
            toggleButton.title = 'Show Log';
        }
    }

    // ===== UI Log Formatting (Corrected) =====
    function addLogEntryToGUI(studyData) {
         if (!logDiv) return; // Make sure logDiv exists

         const logEntry = document.createElement('div');
         logEntry.className = 'log-entry';
         // Format for display including researcher // <-- MODIFIED
         logEntry.textContent = `${studyData.date} ${studyData.time}: ${studyData.researcher} - ${studyData.title} (${studyData.reward} / ${studyData.places} places)`;
         logDiv.appendChild(logEntry);
         logDiv.scrollTop = logDiv.scrollHeight; // Scroll to bottom
    }

     function rebuildVisualLog() {
        if (!logDiv) return;
        logDiv.innerHTML = ''; // Clear existing visual log entries
        // Iterate through the loggedStudies Map and add entries to the GUI
        // Use the corrected addLogEntryToGUI function implicitly
        loggedStudies.forEach(studyData => {
            addLogEntryToGUI(studyData);
        });
        console.log(`Rebuilt visual log with ${loggedStudies.size} entries.`);
    }


    // ===== Google Sheets Logging (Corrected) =====
    function logToGoogleSheet(studyData) {
        // Prepare payload matching the *CORRECTED* COLUMN_ORDER in Apps Script
        const payload = {
            date: studyData.date,
            time: studyData.time,
            title: studyData.title,
            researcher: studyData.researcher, // <-- MODIFIED (Added researcher)
            reward: studyData.reward,
            places: studyData.places
        };

        console.log('Sending to Google Sheet:', payload);

        GM_xmlhttpRequest({
            method: 'POST',
            url: WEB_APP_URL,
            data: JSON.stringify(payload),
            headers: {
                'Content-Type': 'application/json'
            },
            onload: function(response) {
                try {
                    const result = JSON.parse(response.responseText);
                    if (result.status === 'success') {
                        console.log('Google Sheet Log SUCCESS:', result.message);
                    } else {
                        console.error('Google Sheet Log ERROR (App Script):', result.message);
                    }
                } catch (e) {
                     console.error('Google Sheet Log ERROR (Parsing Response):', response.statusText, response.responseText, e);
                }
            },
            onerror: function(response) {
                console.error('Google Sheet Log ERROR (Network/HTTP):', response.statusText, response.responseText);
            },
            ontimeout: function() {
                console.error('Google Sheet Log ERROR: Request timed out.');
            }
        });
    }

    // ===== Study Checking Function (Debounced) =====
    const debouncedCheckStudies = debounce(checkStudies, 1000); // 1-second debounce

    function checkStudies() {
        console.log("checkStudies running");
        const studies = document.querySelectorAll('.studies-list .base-card'); // Target cards within the list

        if (studies.length === 0) {
             // console.log("No studies found on page currently.");
             return;
        }

        let studiesFoundInCheck = 0;
        studies.forEach(study => {
            // Skip if the study is part of the GUI host itself (unlikely but safe)
            if (study.closest('#prolific-logger-host')) {
                return;
            }
            studiesFoundInCheck++;

            // Extract Data (using selectors from original script - verify these are still correct)
            const rewardText = study.querySelector('.reward .amount')?.textContent?.trim() || 'N/A';
            let researcher = null;
            const hostDiv = study.querySelector('.host[data-testid="host"]');
             if (hostDiv) {
                // Try finding the researcher name using a more robust approach if possible
                // This looks for a span directly within the host div first, then falls back
                 // --- Using original selector logic from v2.0 ---
                 let researcherSpan = hostDiv.querySelector('span:not([class])') || hostDiv.querySelector('span[aria-labelledby]');
                 // --- Adjusting slightly based on later HTML provided ---
                 let specificSpan = hostDiv.querySelector('span > span[aria-labelledby]');
                 if (specificSpan) {
                     researcher = specificSpan.textContent.trim(); // Prefer specific structure if found
                 } else if (researcherSpan) {
                      researcher = researcherSpan.textContent.trim().replace(/^By\s+/i, ''); // Fallback
                 }
             }

            const studyTitle = study.querySelector('.title a')?.textContent?.trim() || 'Untitled';
            // Using selector logic for places from v2.0 as API is not used here
            let placesText = study.querySelector('.tag-container.tag span[data-testid="study-tag-places"]')?.textContent?.trim() || '0 places';
            let places = placesText.replace(/\s*places?$/i, '').trim() || '0';

            // Use the data-testid attribute on the parent li as a unique identifier
             const studyIdElement = study.closest('li[data-testid]');
             const studyId = studyIdElement ? studyIdElement.getAttribute('data-testid') : null;

             if (!studyId) {
                console.warn("No data-testid found for study, skipping:", studyTitle, study);
                return; // Skip if no unique ID is found
            }
             if (!researcher) {
                console.warn("No researcher found for study ID:", studyId, studyTitle, study);
                 return; // Skip for now
            }


            const now = new Date();
            const studyData = {
                date: now.toLocaleDateString(),
                time: now.toLocaleTimeString(),
                title: studyTitle,
                researcher: researcher, // Researcher data is extracted
                reward: rewardText,
                places: places,         // Places data from DOM scraping
                id: studyId
            };

            // --- Core Logging Logic ---
            if (targetResearchers.includes(researcher) && !loggedStudies.has(studyId)) {
                console.log(`MATCH FOUND: ${studyData.title} by ${studyData.researcher}`);
                loggedStudies.set(studyId, studyData);
                addLogEntryToGUI(studyData);          // Add to visual log (now includes researcher)
                logToGoogleSheet(studyData);          // Send to Google Sheet (now includes researcher)
                saveState();
            }
        });
        // console.log(`Finished checkStudies. Processed ${studiesFoundInCheck} studies.`);
    }


    // ===== Initialization =====
    console.log("Prolific Logger Script Starting (v2.0.1 Fix)...");
    loadState(); // Load saved data first
    setupGUI();  // Then setup the GUI

    // Wait for the main study list container, then observe it
    waitForElement('.studies-list', (studyList) => {
        console.log("Studies list element found. Initializing MutationObserver.");
        const observer = new MutationObserver(debouncedCheckStudies);

        observer.observe(studyList, {
            childList: true,
            subtree: true
        });

        // Initial check after observer is set up
        debouncedCheckStudies();
    });

})();