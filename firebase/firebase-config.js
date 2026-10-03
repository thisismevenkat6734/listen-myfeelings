/*
 * ============================================================
 * LISTEN MY FEELINGS
 * Firebase Configuration
 * ============================================================
 *
 * Production foundation:
 * - Firebase Authentication
 * - Cloud Firestore
 *
 * Security:
 * - No passwords are stored here.
 * - Firebase Auth manages authentication credentials.
 * - Firestore Security Rules control database access.
 * - Firebase API keys for web applications are not passwords
 *   or private server credentials.
 *
 * IMPORTANT:
 * Never place Firebase Admin SDK credentials,
 * service-account private keys, or other server secrets
 * inside this file or inside the GitHub repository.
 * ============================================================
 */

import {
    initializeApp
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";

import {
    getAuth
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

import {
    getFirestore
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";


/* ============================================================
   FIREBASE PROJECT CONFIGURATION
============================================================ */

const firebaseConfig = {

    apiKey:
        "AIzaSyDaYNxk89vnvc-SHrTNfNrQ0gJCYdnrBOI",

    authDomain:
        "createyourownidentity-2e2a3.firebaseapp.com",

    projectId:
        "createyourownidentity-2e2a3",

    storageBucket:
        "createyourownidentity-2e2a3.firebasestorage.app",

    messagingSenderId:
        "316875593955",

    appId:
        "1:316875593955:web:529cb0fe3c45f2cca54dd6",

    measurementId:
        "G-LXVR8CJWRE"
};


/* ============================================================
   INITIALIZE FIREBASE
============================================================ */

const app =
    initializeApp(
        firebaseConfig
    );


/* ============================================================
   FIREBASE AUTHENTICATION
============================================================ */

const auth =
    getAuth(app);


/* ============================================================
   CLOUD FIRESTORE
============================================================ */

const db =
    getFirestore(app);


/* ============================================================
   EXPORT
============================================================ */

export {
    app,
    auth,
    db
};
