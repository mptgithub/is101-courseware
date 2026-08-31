// ─────────────────────────────────────────────────────────────────────────────
// IS101 Courseware — Student API Client
// Included in every HTML page. Handles login, session, and progress sync.
// ─────────────────────────────────────────────────────────────────────────────

var IS101API = (function() {
  'use strict';

  var SESSION_KEY = 'is101_session_token';
  var NSHE_KEY    = 'is101_nshe_id';

  function getToken()  { return sessionStorage.getItem(SESSION_KEY); }
  function getNsheId() { return sessionStorage.getItem(NSHE_KEY); }
  function isLoggedIn(){ return !!getToken(); }

  function setSession(token, nsheId) {
    sessionStorage.setItem(SESSION_KEY, token);
    sessionStorage.setItem(NSHE_KEY, nsheId);
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(NSHE_KEY);
  }

  async function api(method, path, body) {
    var opts = {
      method: method,
      headers: { 'Content-Type': 'application/json', 'x-session-token': getToken() || '' }
    };
    if (body) opts.body = JSON.stringify(body);
    var r = await fetch('/api' + path, opts);
    return r.json();
  }

  // ── PUBLIC ─────────────────────────────────────────────────────────────────
  async function login(nsheId) {
    var r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nsheId: nsheId })
    });
    var d = await r.json();
    if (d.success) setSession(d.token, d.nsheId);
    return d;
  }

  async function logout() {
    if (getToken()) {
      await fetch('/api/logout', {
        method: 'POST',
        headers: { 'x-session-token': getToken() }
      }).catch(function(){});
    }
    clearSession();
  }

  async function loadProgress() {
    if (!isLoggedIn()) return null;
    return api('GET', '/progress');
  }

  async function markStepDone(unitId, topicId, stepIdx) {
    if (!isLoggedIn()) return;
    return api('POST', '/progress/step', { unitId, topicId, stepIdx });
  }

  async function saveLabAnswer(labId, questionIdx, answerIdx, correct) {
    if (!isLoggedIn()) return;
    return api('POST', '/progress/lab', { labId, questionIdx, answerIdx, correct });
  }

  async function saveExamAttempt(examId, score, total, passed) {
    if (!isLoggedIn()) return;
    return api('POST', '/progress/exam', { examId, score, total, passed });
  }

  async function toggleChecklistStep(stepId, checked) {
    if (!isLoggedIn()) return;
    return api('POST', '/progress/checklist', { stepId, checked });
  }

  return {
    isLoggedIn, getNsheId, login, logout,
    loadProgress, markStepDone, saveLabAnswer, saveExamAttempt, toggleChecklistStep
  };
})();

// ── ApiClient alias — used by START_HERE and new courseware files ─────────────
var ApiClient = {
  login: function(nsheId) { return IS101API.login(nsheId); },
  logout: function() { return IS101API.logout(); },
  getProgress: function() { return IS101API.loadProgress(); },
  saveStepProgress: function(stepId) {
    // stepId format: 'unit-topic-step' e.g. 'ai-t1-watch'
    var parts = stepId.split('-');
    return IS101API.markStepDone(parts[0] || 'u', parts[1] || 'unknown', parts[2] || 0);
  },
  getSession: function() {
    // Return session info from sessionStorage — no server call needed
    if (!IS101API.isLoggedIn()) return Promise.resolve(null);
    return Promise.resolve({ nsheId: IS101API.getNsheId() });
  }
};
