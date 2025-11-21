// ==UserScript==
// @name      Prolific Study Reserver GUI (Optimized v1.3)
// @namespace   Prolific Study Reserver GUI
// @version     1.3 // Updated version - Moved Status Box
// @description Clicks the reserve button at random intervals. Handles latency, specific errors (stops on most, retries on 'High Demand'), includes GUI.
// @author      MikeGPT & Assistant
// @match       https://app.prolific.com/studies/*
// @grant       GM_setValue
// @grant       GM_getValue
// @grant       GM_addStyle
// ==/UserScript==

(function() {
    'use strict';

    let timeoutId = null; // Use timeoutId for clarity with setTimeout
    let statusBox = null;
    let minInterval = GM_getValue('minInterval', 15); // Default: 15 seconds
    let maxInterval = GM_getValue('maxInterval', 30); // Default: 30 seconds
    const CHECK_DELAY_MS = 1500; // Delay in milliseconds after clicking before checking page state (Adjust if needed)

    // --- GUI Styling and Creation (Improved) ---
    GM_addStyle(`
        .prolific-reserver-config-box { /* More specific class name */
            position: fixed;
            top: 50px;
            left: 20px;
            background-color: rgba(0, 0, 0, 0.85); /* Slightly darker */
            color: white;
            padding: 15px;
            border-radius: 8px;
            z-index: 10000;
            font-family: sans-serif;
            font-size: 14px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.5);
        }
        .prolific-reserver-config-box label {
             display: block;
             margin-bottom: 5px;
             font-weight: bold;
        }
        .prolific-reserver-config-box input {
            display: block;
            margin-bottom: 10px; /* Increased spacing */
        }
        .prolific-reserver-config-box input[type="number"] {
            width: 70px; /* Slightly wider */
            padding: 6px;
            border-radius: 4px;
            border: 1px solid #555;
            background-color: #333;
            color: white;
            box-sizing: border-box; /* Include padding in width */
        }
        .prolific-reserver-config-box button {
            background-color: #4CAF50;
            color: white;
            padding: 8px 15px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            margin-top: 10px;
            transition: background-color 0.2s;
        }
        .prolific-reserver-config-box button:hover {
            background-color: #45a049;
        }
        .prolific-reserver-status-box { /* More specific class name */
            position: fixed;
            top: 20px; /* Vertical position from top */
            right: 420px; /* <<< CHANGED: Increased from 20px to move left */
            padding: 12px 15px;
            background-color: #e74c3c; /* Red */
            color: white;
            z-index: 9999;
            border-radius: 5px;
            font-family: sans-serif;
            font-size: 14px;
            font-weight: bold;
            box-shadow: 0 2px 5px rgba(0,0,0,0.3);
            text-align: center;
            min-width: 150px;
        }
    `);

    function createConfigGUI() {
        // Remove existing config box if present
        const existingBox = document.querySelector('.prolific-reserver-config-box');
        if (existingBox) {
            existingBox.remove();
        }

        const configBox = document.createElement('div');
        configBox.className = 'prolific-reserver-config-box';

        configBox.innerHTML = `
            <h4>Study Reserver Config</h4>
            <label for="minIntervalInput">Min Interval (sec):</label>
            <input type="number" id="minIntervalInput" value="${minInterval}" min="1">

            <label for="maxIntervalInput">Max Interval (sec):</label>
            <input type="number" id="maxIntervalInput" value="${maxInterval}" min="1">

            <button id="saveIntervalsBtn">Save & Close</button>
            <p style="font-size: 12px; margin-top: 15px; color: #ccc;">Press F7 to Start/Restart, F8 to Stop.</p>
        `;

        document.body.appendChild(configBox);

        document.getElementById('saveIntervalsBtn').addEventListener('click', function() {
            const newMin = parseInt(document.getElementById('minIntervalInput').value, 10);
            const newMax = parseInt(document.getElementById('maxIntervalInput').value, 10);

            if (!isNaN(newMin) && !isNaN(newMax) && newMin > 0 && newMax >= newMin) {
                minInterval = newMin;
                maxInterval = newMax;
                GM_setValue('minInterval', minInterval);
                GM_setValue('maxInterval', maxInterval);
                console.log(`Intervals saved: ${minInterval}-${maxInterval} seconds. Restart script (F7) if running.`);
                configBox.remove();
                updateStatusBox(`Intervals Saved (${minInterval}-${maxInterval}s). Press F7 to Start/Restart.`);
                 setTimeout(() => { if (statusBox && statusBox.textContent.startsWith('Intervals Saved')) updateStatusBox('Script Stopped.'); }, 3500); // Revert status after timeout
            } else {
                alert('Invalid interval range! Min must be > 0 and less than or equal to Max.');
            }
        });
    }

    // --- Status Box Functions (Improved) ---
     function createStatusBox(message = 'Script Initialized. Press F7.') {
        if (statusBox) statusBox.remove(); // Remove old one if exists
        statusBox = document.createElement('div');
        statusBox.textContent = message;
        statusBox.className = 'prolific-reserver-status-box';
        statusBox.style.backgroundColor = '#f39c12'; // Initial/Paused color (Yellow/Orange)
        document.body.appendChild(statusBox);
    }

    function updateStatusBox(message, isRunning = false) {
        if (!statusBox) createStatusBox(message);
        else statusBox.textContent = message;

        let bgColor = '#f39c12'; // Default: Yellow/Orange (Paused/Info)
        if (isRunning) {
            bgColor = '#2ecc71'; // Green (Running)
        } else if (message.toLowerCase().includes('stopped') || message.toLowerCase().includes('error')) {
             bgColor = '#e74c3c'; // Red (Stopped/Error)
        }
         // else keep yellow/orange for info messages like 'Saved'

        statusBox.style.backgroundColor = bgColor;
    }

    function removeStatusBox() {
        if (statusBox) {
            statusBox.remove();
            statusBox = null;
        }
    }

    // --- Core Logic Functions ---

    // Function to generate a random interval between min and max seconds
    function getRandomInterval(minSec, maxSec) {
        // Ensure minSec is not greater than maxSec; if so, swap them or use only minSec
        if (minSec > maxSec) {
            console.warn(`Min interval (${minSec}s) > Max interval (${maxSec}s). Using ${minSec}s as interval.`);
            return minSec * 1000;
        }
        // +1 to make the max value inclusive
        return Math.floor((Math.random() * (maxSec - minSec + 1) + minSec) * 1000);
    }

    // Function to check for specific error messages
    function checkForKnownErrors() {
        // --- Check 1: Standard Prolific Errors (within .error or [role="alert"]) ---
        const standardErrorElements = Array.from(document.querySelectorAll('.error, [role="alert"]')); // Common selectors for errors
        // Use toLowerCase() for case-insensitive matching
        const isFull = standardErrorElements.some(el => el.textContent.toLowerCase().includes('study is full'));
        const isHighDemand = standardErrorElements.some(el => el.textContent.toLowerCase().includes('study is in high demand') || el.textContent.toLowerCase().includes('high demand'));
        const isReturned = standardErrorElements.some(el => el.textContent.toLowerCase().includes('already returned this submission'));

        // Prioritize critical errors over high demand if both somehow appear
        if (isFull) {
             console.log('Error detected: Study Full');
             return 'STUDY_FULL';
        }
        if (isReturned) {
             console.log('Error detected: Already Returned');
            return 'ALREADY_RETURNED';
        }
        // Check high demand last among standard errors
        if (isHighDemand) {
            console.log('Error detected: High Demand');
            return 'HIGH_DEMAND'; // Will be handled specially
        }

        // --- Check 2: Element UI Style Notification Popups (like the "Paused" one) ---
        // These often appear temporarily and might need specific targeting
        const notificationGroups = Array.from(document.querySelectorAll('.el-notification__group'));
        for (const group of notificationGroups) {
            const titleElement = group.querySelector('h2.el-notification__title');
            const contentElement = group.querySelector('.el-notification__content p'); // Target the <p> inside

            // Check specifically for the "Paused Study" notification (case-insensitive)
            if (titleElement && titleElement.textContent.trim().toLowerCase() === 'error' &&
                contentElement && contentElement.textContent.toLowerCase().includes('researcher has paused the study'))
            {
                console.log('Error detected: Study Paused by Researcher');
                return 'STUDY_PAUSED'; // Found the specific paused study error
            }
            // Add checks for other el-notification errors if necessary
        }

        // --- No known blocking error found ---
        return null;
    }

    // Function to check if the study seems successfully accepted
    function isStudySuccessfullyReserved() {
        const startButton = document.querySelector('button[data-testid="start-now"]');
        const finishedButton = document.querySelector('button[data-testid="finished-button"]'); // Original check

        // Condition 1: The 'finished' button exists
        if (finishedButton) {
            console.log('Success detected: "Finished" button found.');
            return true;
        }

        // Condition 2: The 'start-now' button is GONE, AND no known errors are visible
        // This check runs *after* checkForKnownErrors in checkReservationStatus, so we only need to check for the button absence here.
        if (!startButton) {
             // We rely on the fact that checkForKnownErrors() was called just before this.
             // If an error *was* present, checkReservationStatus would have already handled it.
             // So, if we reach here and the start button is gone, it's likely success (or a page state we didn't anticipate).
             console.log('Potential Success: "Start Now" button gone and no blocking errors detected in prior check.');
             return true;
        }

        // If start button still exists, not successful yet
        return false;
    }

    // Function to stop the script
    function stopScript(reason) {
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
            console.log(`Script stopped: ${reason}`);
            updateStatusBox(`Script Stopped: ${reason}`, false); // Explicitly set isRunning to false
        } else {
            console.log('Stop command received, but script was not running.');
            updateStatusBox('Script Not Running.', false); // Update status if F8 pressed when not running
        }
    }

    // Function that performs the check AFTER the delay
    function checkReservationStatus() {
        console.log('Checking reservation status...');

        const errorType = checkForKnownErrors(); // Check for all known errors

        // --- Handle Errors ---
        if (errorType) { // An error was detected
            if (errorType === 'HIGH_DEMAND') {
                // High demand error occurred: Log it, update status, and schedule the *next* attempt without stopping.
                console.log('Study is in high demand, will retry...');
                // Calculate next interval here to display it
                const nextRetryIntervalMs = getRandomInterval(minInterval, maxInterval);
                updateStatusBox(`High Demand. Retrying... Next in ${(nextRetryIntervalMs / 1000).toFixed(1)}s`, true);
                timeoutId = setTimeout(attemptReservation, nextRetryIntervalMs); // Schedule the next attempt directly
                return; // Exit this checkReservationStatus call
            } else {
                // It's a different, script-stopping error (Full, Paused, Returned, etc.)
                stopScript(`Error - ${errorType}`);
                return; // Exit checkReservationStatus permanently
            }
        }

        // --- Handle Success ---
        // If errorType was null (no blocking error found), proceed to check for success
        if (isStudySuccessfullyReserved()) {
            stopScript('Study Reserved!');
            // Maybe play a sound here? Example (requires browser/extension support):
            // try { new Audio('https://www.soundjay.com/button/sounds/button-16.mp3').play(); } catch(e) { console.warn("Could not play sound"); }
            return; // Exit checkReservationStatus permanently
        }

        // --- Continue Trying ---
        // If no blocking error and no success, schedule the next attempt
        console.log('Study not reserved yet and no critical errors. Scheduling next attempt...');
        scheduleNextAttempt(); // Call the function to schedule the next random attempt
    }


    // Function to attempt clicking and schedule the check
    function attemptReservation() {
        console.log('Attempting reservation...');
        const button = document.querySelector('button[data-testid="start-now"]');

        if (button && !button.disabled) { // Check if button exists and is not disabled
            button.click();
            console.log('"Start Now" button clicked. Waiting for page update...');
            updateStatusBox('Clicked! Waiting...', true);

            // ** CRITICAL: Wait before checking the result **
            timeoutId = setTimeout(checkReservationStatus, CHECK_DELAY_MS);

        } else {
            // Button not found or disabled. Maybe page loaded weirdly, study gone, or already accepted?
            if (!button) {
                console.log('"Start Now" button not found on this attempt. Checking state immediately...');
            } else { // button must be disabled
                 console.log('"Start Now" button is disabled. Checking state immediately...');
            }
            // Run the check function immediately, as the state might already reflect success/error.
            // No artificial delay needed if we couldn't click.
            checkReservationStatus();
        }
    }

    // Function to schedule the next attempt with a random delay
    function scheduleNextAttempt() {
        const nextInterval = getRandomInterval(minInterval, maxInterval);
        console.log(`Next attempt in ${(nextInterval / 1000).toFixed(1)} seconds.`);
        updateStatusBox(`Running... Next try in ${(nextInterval / 1000).toFixed(1)}s`, true);
        timeoutId = setTimeout(attemptReservation, nextInterval);
    }


    // --- Event Listeners ---
    document.addEventListener('keydown', function(event) {
        if (event.key === 'F7') {
            event.preventDefault();
            if (timeoutId) {
                console.log('Restarting script...');
                clearTimeout(timeoutId); // Clear existing timer before restarting
                timeoutId = null; // Important to reset timeoutId state
            }
            console.log(`Starting script with interval ${minInterval}-${maxInterval} seconds.`);
            // Create/update status box immediately
            updateStatusBox('Starting...', true); // Show starting status

            // Start the first attempt relatively quickly (e.g., after 0.5 sec)
            const firstAttemptDelay = 500;
            console.log(`First attempt in ${(firstAttemptDelay / 1000).toFixed(1)} seconds.`);
            updateStatusBox(`Starting... First try soon`, true); // Update status
            timeoutId = setTimeout(attemptReservation, firstAttemptDelay); // Start the cycle

        } else if (event.key === 'F8') {
            event.preventDefault();
            stopScript('Manually Stopped (F8)');

        } else if (event.key === 'F9') {
            event.preventDefault();
            console.log('Opening configuration GUI...');
            createConfigGUI(); // This function now handles removing old GUI if needed
        }
    });

    // --- Initial Script Load ---
    console.log('Prolific Study Reserver Loaded. Press F7 to Start, F8 to Stop, F9 for Config.');
    createStatusBox(); // Show initial status box ("Initialized...")

})();