import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  onAuthStateChanged, 
  signInAnonymously, 
  signOut
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  addDoc, 
  onSnapshot, 
  serverTimestamp 
} from 'firebase/firestore';
import { 
  Upload, 
  FileText, 
  Download, 
  LogOut, 
  Activity, 
  CheckCircle, 
  AlertCircle,
  Loader2,
  Bug,
  X,
  Globe
} from 'lucide-react';

// --- WICHTIG: IHRE FIREBASE KONFIGURATION ---
const firebaseConfig = {
  apiKey: "AIzaSyCG50HVvFxVy2UDqMr87zI9ufz-fMtkK8s",
  authDomain: "invoice-processing-autom.firebaseapp.com",
  projectId: "invoice-processing-autom",
  storageBucket: "invoice-processing-autom.firebasestorage.app",
  messagingSenderId: "813058723595",
  appId: "1:813058723595:web:25bb4ffe185f8461f79c0e",
  measurementId: "G-L8HJSP0DRH"
};

// Initialize Firebase only if config is present
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = 'invoice-saas-v1';

// --- PDF.js Setup ---
const PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

// --- Helper: Date Standardization ---
const MONTH_MAP = {
  'january': '01', 'januar': '01', 'jan': '01',
  'february': '02', 'februar': '02', 'feb': '02',
  'march': '03', 'märz': '03', 'maerz': '03', 'mar': '03',
  'april': '04', 'apr': '04',
  'may': '05', 'mai': '05',
  'june': '06', 'juni': '06', 'jun': '06',
  'july': '07', 'juli': '07', 'jul': '07',
  'august': '08', 'aug': '08',
  'september': '09', 'sep': '09',
  'october': '10', 'oktober': '10', 'oct': '10', 'okt': '10',
  'november': '11', 'nov': '11',
  'december': '12', 'dezember': '12', 'dec': '12', 'dez': '12'
};

const standardizeDate = (rawDate) => {
  if (!rawDate) return '';
  
  // 1. Clean up excessive whitespace
  let clean = rawDate.trim().replace(/\s+/g, ' ');

  // 2. Try ISO format (YYYY - MM - DD) with spaces allowed
  let isoMatch = clean.match(/^(\d{4})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})$/);
  if (isoMatch) {
    const [_, y, m, d] = isoMatch;
    return `${d.padStart(2, '0')}.${m.padStart(2, '0')}.${y}`;
  }

  // 3. Try Textual format (DD. Month YYYY)
  let textMatch = clean.match(/^(\d{1,2})\.?\s+([a-zA-ZäöüÄÖÜ]+)\s+(\d{4})$/);
  if (textMatch) {
    const [_, d, monthStr, y] = textMatch;
    const monthKey = monthStr.toLowerCase().replace('.', ''); 
    const m = MONTH_MAP[monthKey];
    if (m) {
      return `${d.padStart(2, '0')}.${m}.${y}`;
    }
  }

  // 4. Try standard numeric (DD . MM . YYYY) with spaces allowed
  let numMatch = clean.match(/^(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4})$/);
  if (numMatch) {
    const [_, d, m, y] = numMatch;
    return `${d.padStart(2, '0')}.${m.padStart(2, '0')}.${y}`;
  }

  return clean;
};

// --- Configuration Rules ---
const COUNTRY_RULES = [
  {
    id: 'IT',
    name: 'Italy',
    indicators: ['Data della fattura', 'Italien', 'Italy', 'Italia'], 
    keywords: {
      date: 'Data\\s*della\\s*fattura\\s*:?', 
      number: 'Numero\\s*fattura\\s*:?', 
      amount: 'Prezzo\\s*totale'
    },
    booking: {
      text: 'Verkauf über Kaufland Italien',
      soll: 10002,
      haben: 4320,
      taxKey: '240',
      euLand: 'IT', 
      euRate: '0.22'
    }
  },
  {
    id: 'FR',
    name: 'France',
    indicators: ['Date de facture', 'Frankreich', 'France', 'République Française'], 
    keywords: {
      date: 'Date\\s*(?:de)?\\s*facture', 
      number: '(?:Num[ée.]ro|N[°o.]|Facture\\s*N[°o.]?)\\s*(?:de)?\\s*facture\\s*:?', 
      amount: '(?:Prix\\s+|Montant\\s+)?total'
    },
    booking: {
      text: 'Verkauf über Kaufland Frankreich',
      soll: 10002,
      haben: 4320,
      taxKey: '240',
      euLand: 'AT', 
      euRate: '0.2'
    }
  },
  {
    id: 'SK',
    name: 'Slovakia',
    indicators: ['Dátum faktúry', 'Datum faktury', 'Slowakei', 'Slovakia', 'Slovenská'],
    keywords: {
      date: 'tum\\s*fak', 
      number: '(?:[ČC.]+[íi.]slo\\s*fakt[úu.]r[ya.]?|Fakt[úu.]ra\\s*[čc.]|Fakt[úu.]ra)', 
      amount: '(?:Celkov[áa.]\\s*cena|Spolu|K\\s*úhrade)'
    },
    booking: {
      text: 'Verkauf über Kaufland Slowakei',
      soll: 10002,
      haben: 4320,
      taxKey: '240',
      euLand: 'SK',
      euRate: '0.23'
    }
  },
  {
    id: 'AT',
    name: 'Austria',
    indicators: ['Österreich', 'Austria'], 
    keywords: {
      date: 'Rechnungsdatum',
      number: 'Rechnungsnummer',
      amount: 'Gesamtpreis'
    },
    booking: {
      text: 'Verkauf über Kaufland Österreich',
      soll: 10002,
      haben: 4320,
      taxKey: '240',
      euLand: 'AT',
      euRate: '0.2'
    }
  },
  {
    id: 'DE',
    name: 'Germany',
    indicators: ['Deutschland', 'Germany'],
    keywords: {
      date: 'Rechnungsdatum',
      number: 'Rechnungsnummer',
      amount: 'Gesamtpreis'
    },
    booking: {
      text: 'Verkauf über Kaufland Deutschland',
      soll: 10002,
      haben: 4400,
      taxKey: '', 
      euLand: 'DE',
      euRate: '0.19'
    }
  }
];

// --- Helper Functions ---

const loadPdfJs = () => {
  return new Promise((resolve, reject) => {
    if (window.pdfjsLib) {
      resolve(window.pdfjsLib);
      return;
    }
    const script = document.createElement('script');
    script.src = PDFJS_URL;
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      resolve(window.pdfjsLib);
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
};

const parseCurrency = (str) => {
  if (!str) return 0.0;
  let clean = str.replace(/[€$£"\sA-Za-z]/g, ''); 
  
  const lastCommaIndex = clean.lastIndexOf(',');
  const lastDotIndex = clean.lastIndexOf('.');

  if (lastCommaIndex > lastDotIndex) {
    clean = clean.replace(/\./g, '');
    clean = clean.replace(',', '.');
  } else {
    clean = clean.replace(/,/g, '');
  }
  
  const val = parseFloat(clean);
  return isNaN(val) ? 0.0 : val;
};

// --- Main Application Component ---

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [pdfLib, setPdfLib] = useState(null);
  const [error, setError] = useState(null);
  
  const [debugMode, setDebugMode] = useState(false);
  const [lastProcessedText, setLastProcessedText] = useState("");

  // 1. Initialize Auth
  useEffect(() => {
    signInAnonymously(auth).catch(err => console.error("Auth Error", err));
    
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // 2. Load PDF Library
  useEffect(() => {
    loadPdfJs().then(lib => setPdfLib(lib)).catch(err => console.error("Failed to load PDF.js", err));
  }, []);

  // 3. Listen for User's Invoices
  useEffect(() => {
    if (!user) {
      setInvoices([]);
      return;
    }

    const q = collection(db, 'artifacts', appId, 'users', user.uid, 'invoices');
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setInvoices(data);
    }, (err) => {
      console.error("Firestore error:", err);
      setError("Verbindung zur Datenbank fehlgeschlagen.");
    });

    return () => unsubscribe();
  }, [user]);

  // --- Invoice Processing Logic ---
  const processInvoice = async (file) => {
    if (!pdfLib) return;
    
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfLib.getDocument({ data: arrayBuffer }).promise;
      const page = await pdf.getPage(1);
      const textContent = await page.getTextContent();
      
      const textItems = textContent.items.map(item => item.str);
      const text = textItems.join('\n'); 
      const singleLineText = textItems.join(' '); 

      setLastProcessedText(text);
      console.log(`Processing ${file.name}...`); 

      // 1. Detect Country Rule
      let matchedRule = null;

      if (/Data\s*della\s*fattura/i.test(text)) {
        matchedRule = COUNTRY_RULES.find(r => r.id === 'IT');
      } else if (/Date\s*(?:de)?\s*facture/i.test(text)) {
        matchedRule = COUNTRY_RULES.find(r => r.id === 'FR');
      } else if (/D[áa.]tum\s*(?:vyhotovenia|fakt[úu.]ry)/i.test(text) || /tum\s*fak/i.test(text)) {
        matchedRule = COUNTRY_RULES.find(r => r.id === 'SK');
      } else if (/Rechnungsdatum/i.test(text)) {
        if (/Österreich|Austria/i.test(text)) {
          matchedRule = COUNTRY_RULES.find(r => r.id === 'AT');
        } else {
          matchedRule = COUNTRY_RULES.find(r => r.id === 'DE');
        }
      }

      if (!matchedRule) {
        if (/Italia|Italy|Italien/i.test(text)) matchedRule = COUNTRY_RULES.find(r => r.id === 'IT');
        else if (/France|Frankreich|République/i.test(text)) matchedRule = COUNTRY_RULES.find(r => r.id === 'FR');
        else if (/Slovakia|Slowakei|Slovenská/i.test(text)) matchedRule = COUNTRY_RULES.find(r => r.id === 'SK');
        else if (/Austria|Österreich/i.test(text)) matchedRule = COUNTRY_RULES.find(r => r.id === 'AT');
        else matchedRule = COUNTRY_RULES.find(r => r.id === 'DE');
      }

      // 2. Extract Data
      const data = {
        filename: file.name,
        countryId: matchedRule.id,
        invoiceNumber: '',
        date: '',
        amount: 0.0,
        sollkonto: matchedRule.booking.soll,
        habenkonto: matchedRule.booking.haben,
        bookingText: matchedRule.booking.text,
        taxKey: matchedRule.booking.taxKey,
        euLand: matchedRule.booking.euLand,
        euRate: matchedRule.booking.euRate,
        createdAt: serverTimestamp()
      };

      // --- DATE Extraction ---
      const dateKey = matchedRule.keywords.date;
      const dateRegex = new RegExp(
        `${dateKey}.{0,40}?(\d{4}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{1,2}|\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{4}|\d{1,2}\.?\s*[a-zA-ZäöüÄÖÜ]+\s*\d{4})`, 
        'i'
      );
      
      let dateMatch = singleLineText.match(dateRegex);
      if (!dateMatch) dateMatch = text.match(dateRegex);
      
      if (dateMatch) {
        data.date = standardizeDate(dateMatch[1]);
      } else {
        const globalIso = text.match(/\b(\d{4})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})\b/);
        if (globalIso) {
           data.date = standardizeDate(globalIso[0]);
        }
      }

      // --- NUMBER Extraction ---
      const numKey = matchedRule.keywords.number;
      const strictNumRegex = new RegExp(`${numKey}.{0,20}?([A-Za-z0-9\-/]*\d+[A-Za-z0-9\-/]*)`, 'i');
      
      const lines = text.split('\n');
      let numFound = false;
      
      for (const line of lines) {
        const match = line.match(strictNumRegex);
        if (match) {
          data.invoiceNumber = match[1];
          numFound = true;
          break;
        }
      }
      if (!numFound) {
        const looseNumRegex = new RegExp(`${numKey}.{0,40}?([A-Za-z0-9\-/]*\d+[A-Za-z0-9\-/]*)`, 'i');
        let numMatch = singleLineText.match(looseNumRegex);
        if (numMatch) data.invoiceNumber = numMatch[1];
      }

      // 8-DIGIT FALLBACK
      if (!data.invoiceNumber || !/^\d{8}$/.test(data.invoiceNumber)) {
        const eightDigitMatch = text.match(/\b(\d{8})\b/);
        if (eightDigitMatch) {
          data.invoiceNumber = eightDigitMatch[1];
        }
      }

      // --- AMOUNT Extraction ---
      const amountKey = matchedRule.keywords.amount;
      const amountRegex = new RegExp(`${amountKey}.{0,60}?([\d.,]+)\s*[€A-Z]*`, 'i');
      let amountMatch = singleLineText.match(amountRegex);
      
      if (amountMatch && (amountMatch[1].includes('.') || amountMatch[1].includes(','))) {
        data.amount = parseCurrency(amountMatch[1]);
      } else {
        for (const line of lines) {
           if (new RegExp(amountKey, 'i').test(line)) {
             const priceMatch = line.match(/([\d.,]+)\s*[€A-Z]*/);
             if (priceMatch && (priceMatch[1].includes('.') || priceMatch[1].includes(','))) {
                data.amount = parseCurrency(priceMatch[1]);
                break;
             }
           }
        }
      }

      if (user) {
        await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'invoices'), data);
      }

    } catch (err) {
      console.error(`Error processing ${file.name}:`, err);
    }
  };

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0 || !pdfLib) return;

    setProcessing(true);
    setError(null);
    setLastProcessedText("");

    try {
      await Promise.all(files.map(file => processInvoice(file)));
    } catch (err) {
      console.error("Batch processing error:", err);
      setError("Fehler beim Verarbeiten der Dateien.");
    } finally {
      setProcessing(false);
      e.target.value = null; 
    }
  };

  const downloadCSV = () => {
    if (invoices.length === 0) return;
    
    const headers = [
      'Land', 
      'Belegdatum', 
      'Belegnummer', 
      'Buchungstext', 
      'Buchungsbetrag', 
      'Sollkonto', 
      'Habenkonto', 
      'Steuerschluessel', 
      'EU Land', 
      'EU %'
    ];
    
    const rows = invoices.map(inv => [
      inv.countryId,
      inv.date,
      inv.invoiceNumber,
      inv.bookingText,
      inv.amount.toFixed(2).replace('.', ','), 
      inv.sollkonto,
      inv.habenkonto,
      inv.taxKey || '',
      inv.euLand,
      inv.euRate
    ]);

    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(';'), ...rows.map(e => e.join(';'))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "buchungsliste_export.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-xl">
          <div className="mb-6 flex justify-center">
            <div className="rounded-full bg-blue-100 p-3">
              <FileText className="h-8 w-8 text-blue-600" />
            </div>
          </div>
          <h1 className="mb-2 text-center text-2xl font-bold text-gray-900">InvoiceAuto SaaS</h1>
          <p className="mb-8 text-center text-gray-500">
            Automatisierte Buchungserstellung (DE, FR, SK, AT, IT)
          </p>
          <button 
            onClick={() => signInAnonymously(auth)}
            className="w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white transition hover:bg-blue-700"
          >
            Starten
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-900">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <FileText className="h-6 w-6 text-blue-600" />
            <h1 className="text-xl font-bold text-gray-900">InvoiceAuto <span className="text-xs font-normal text-gray-500 px-2 py-1 bg-gray-100 rounded-full">PRO</span></h1>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setDebugMode(!debugMode)}
              className={`rounded-md p-2 hover:bg-gray-100 ${debugMode ? 'text-blue-600 bg-blue-50' : 'text-gray-400'}`}
              title="Debug Info"
            >
              <Bug className="h-5 w-5" />
            </button>
            <span className="hidden text-sm text-gray-500 sm:block">User: {user.uid.slice(0,6)}...</span>
            <button 
              onClick={() => signOut(auth)}
              className="rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              title="Abmelden"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        
        {/* Debug Panel */}
        {debugMode && (
          <div className="mb-8 rounded-xl bg-gray-900 p-4 text-gray-100 shadow-lg">
            <div className="mb-2 flex items-center justify-between border-b border-gray-700 pb-2">
              <h3 className="font-mono text-sm font-bold text-green-400">PDF RÖNTGENBLICK (DEBUG)</h3>
              <button onClick={() => setDebugMode(false)}><X className="h-4 w-4" /></button>
            </div>
            <p className="mb-2 text-xs text-gray-400">Das sieht das Programm im Hintergrund:</p>
            <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap rounded bg-black p-4 font-mono text-xs leading-relaxed text-gray-300">
              {lastProcessedText || "Noch keine Datei verarbeitet. Laden Sie eine PDF hoch."}
            </pre>
          </div>
        )}

        {/* Dashboard Stats */}
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl bg-white p-6 shadow-sm border border-gray-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">Verarbeitete Rechnungen</p>
                <p className="mt-1 text-3xl font-bold text-gray-900">{invoices.length}</p>
              </div>
              <div className="rounded-full bg-green-100 p-3 text-green-600">
                <CheckCircle className="h-6 w-6" />
              </div>
            </div>
          </div>
          <div className="rounded-xl bg-white p-6 shadow-sm border border-gray-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">Länder</p>
                <div className="mt-1 flex gap-2">
                  {['DE', 'FR', 'SK', 'AT', 'IT'].map(c => {
                    const count = invoices.filter(i => i.countryId === c).length;
                    return count > 0 ? (
                      <span key={c} className="inline-flex items-center rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
                        {c}: {count}
                      </span>
                    ) : null;
                  })}
                </div>
              </div>
              <div className="rounded-full bg-blue-100 p-3 text-blue-600">
                <Globe className="h-6 w-6" />
              </div>
            </div>
          </div>
           <div className="rounded-xl bg-indigo-600 p-6 shadow-sm text-white flex flex-col justify-between">
            <div>
              <p className="text-sm font-medium text-indigo-100">Export</p>
              <h3 className="mt-1 text-xl font-bold">CSV Herunterladen</h3>
            </div>
            <button 
                onClick={downloadCSV}
                disabled={invoices.length === 0}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-white/20 py-2 text-sm font-semibold text-white transition hover:bg-white/30 disabled:opacity-50"
              >
                <Download className="h-4 w-4" /> Exportieren
              </button>
          </div>
        </div>

        {/* Upload Section */}
        <div className="mb-8 rounded-xl border-2 border-dashed border-gray-300 bg-white p-8 text-center transition hover:border-blue-400">
          <div className="flex flex-col items-center">
            <div className="mb-4 rounded-full bg-blue-50 p-4">
              <Upload className="h-8 w-8 text-blue-600" />
            </div>
            <h3 className="mb-2 text-lg font-medium text-gray-900">Rechnungen hochladen (PDF)</h3>
            <p className="mb-6 text-sm text-gray-500">Unterstützt: Deutschland, Frankreich, Slowakei, Österreich, Italien</p>
            <input 
              type="file" 
              accept="application/pdf"
              multiple
              onChange={handleFileUpload}
              className="hidden"
              id="file-upload"
              disabled={processing}
            />
            <label 
              htmlFor="file-upload"
              className={`cursor-pointer rounded-lg bg-blue-600 px-6 py-2.5 font-semibold text-white shadow-sm transition hover:bg-blue-700 ${processing ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {processing ? 'Verarbeite...' : 'PDFs Auswählen'}
            </label>
            {error && (
              <div className="mt-4 flex items-center gap-2 text-sm text-red-600">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}
          </div>
        </div>

        {/* Table Section */}
        <div className="overflow-hidden rounded-xl bg-white shadow-sm border border-gray-200">
          <div className="border-b border-gray-200 bg-gray-50 px-6 py-4">
            <h3 className="text-base font-semibold leading-6 text-gray-900">Buchungsliste</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Land</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Datum</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Beleg Nr.</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Betrag</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Soll / Haben</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Steuer</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">EU Info</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {invoices.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="px-6 py-12 text-center text-gray-500">
                      Noch keine Rechnungen. Laden Sie PDFs hoch.
                    </td>
                  </tr>
                ) : (
                  invoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-6 py-4 text-sm font-bold text-gray-700">{inv.countryId}</td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">{inv.date}</td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">{inv.invoiceNumber}</td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">{inv.amount.toFixed(2)} €</td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                        {inv.sollkonto} / <span className="font-semibold">{inv.habenkonto}</span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">{inv.taxKey || '-'}</td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                        {inv.euLand} ({inv.euRate})
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}