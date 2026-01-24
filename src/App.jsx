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
  deleteDoc,
  doc,
  writeBatch, 
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
  Trash2,
  Settings,
  Save
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

const app = firebaseConfig.apiKey !== "HIER_IHREN_API_KEY_EINFUEGEN" ? initializeApp(firebaseConfig) : null;
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;
const appId = 'invoice-saas-v1';

// --- PDF.js Setup (via CDN) ---
const PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

// --- Standardwerte für Währungskurse ---
const DEFAULT_RATES = {
  CZK: 24.247655,
  PLN: 4.213986
};

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

const standardizeDate = (rawDate) => {
  if (!rawDate) return '';
  let clean = rawDate.replace(/[\u200B-\u200D\uFEFF]/g, '').trim().replace(/\s+/g, ' ');

  const MONTH_MAP = {
    'january': '01', 'januar': '01', 'jan': '01', 'ledna': '01', 'stycznia': '01',
    'february': '02', 'februar': '02', 'feb': '02', 'února': '02', 'lutego': '02',
    'march': '03', 'märz': '03', 'maerz': '03', 'mar': '03', 'března': '03', 'marca': '03',
    'april': '04', 'apr': '04', 'dubna': '04', 'kwietnia': '04',
    'may': '05', 'mai': '05', 'května': '05', 'maja': '05',
    'june': '06', 'juni': '06', 'jun': '06', 'června': '06', 'czerwca': '06',
    'july': '07', 'juli': '07', 'jul': '07', 'července': '07', 'lipca': '07',
    'august': '08', 'aug': '08', 'srpna': '08', 'sierpnia': '08',
    'september': '09', 'sep': '09', 'září': '09', 'września': '09',
    'october': '10', 'oktober': '10', 'oct': '10', 'okt': '10', 'října': '10', 'października': '10',
    'november': '11', 'nov': '11', 'listopadu': '11', 'listopada': '11',
    'december': '12', 'dezember': '12', 'dec': '12', 'dez': '12', 'prosince': '12', 'grudnia': '12'
  };

  let isoMatch = clean.match(/^(\d{4})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})$/);
  if (isoMatch) return `${isoMatch[3].padStart(2, '0')}.${isoMatch[2].padStart(2, '0')}.${isoMatch[1]}`;

  let textMatch = clean.match(/^(\d{1,2})\.?\s+([a-zA-ZäöüÄÖÜáčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]+)\s+(\d{4})$/);
  if (textMatch) {
    const [_, d, monthStr, y] = textMatch;
    const monthKey = monthStr.toLowerCase().replace('.', ''); 
    const m = MONTH_MAP[monthKey];
    if (m) return `${d.padStart(2, '0')}.${m}.${y}`;
  }

  let numMatch = clean.match(/^(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4})$/);
  if (numMatch) return `${numMatch[1].padStart(2, '0')}.${numMatch[2].padStart(2, '0')}.${numMatch[3]}`;

  return clean;
};

// Intelligente Währungserkennung
const parseCurrency = (str) => {
  if (!str) return 0.0;
  let clean = str.trim();
  
  if (/\d\s+\d/.test(clean)) {
    clean = clean.replace(/\s+/g, '');
  }
  
  clean = clean.replace(/[^0-9.,-]/g, '');

  const lastComma = clean.lastIndexOf(',');
  const lastDot = clean.lastIndexOf('.');

  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) {
        clean = clean.replace(/\./g, '').replace(',', '.');
    } else {
        clean = clean.replace(/,/g, '');
    }
  } 
  else if (lastComma > -1) {
    const afterComma = clean.substring(lastComma + 1);
    if (afterComma.length === 3) {
        clean = clean.replace(/,/g, '');
    } else {
        clean = clean.replace(',', '.');
    }
  }
  else if (lastDot > -1) {
     const afterDot = clean.substring(lastDot + 1);
     if (afterDot.length === 3) {
        clean = clean.replace(/\./g, '');
     }
  }

  return parseFloat(clean) || 0.0;
};

// --- Länderregeln (Update: SK Betragssuche) ---
const COUNTRY_RULES = [
  {
    id: 'CZ',
    name: 'Czech Republic',
    indicators: ['Česká republika', 'Czech', 'Faktura', 'DIČ', 'IČO'],
    currency: 'Kč',
    keywords: {
      date: 'Datum\\s*faktury\\s*:?', 
      number: '(?:[CcČč].{0,10}[sSšŠ]lo.{0,10}fakt[uUúÚ]ry|Faktura\\s*.{0,5}[cčČ]\\.?|Doklad\\s*.{0,5}[cčČ]\\.?)\\s*:?', 
      amount: '(?:Celkov.*?cena.*?ch.*?nk|Celkem\\s*k\\s*úhradě|K\\s*úhradě|Celková\\s*částka)' 
    },
    booking: { text: 'Verkauf über Kaufland Tschechien', soll: 10002, haben: 4320, taxKey: '240', euLand: 'CZ', euRate: '0.21' }
  },
  {
    id: 'PL',
    name: 'Poland',
    indicators: ['Polska', 'Poland', 'Faktura VAT', 'NIP', 'PL'],
    currency: 'zł',
    keywords: {
      date: 'Data\\s*faktury\\s*:?', 
      number: '(?:Numer\\s*.{0,10}rachunku|Faktura\\s*.{0,5}nr)\\s*:?', 
      amount: '(?:Cena.*?kowita|Do\\s*zapłaty|Razem\\s*brutto|Kwota\\s*do\\s*zapłaty|Suma)'
    },
    booking: { text: 'Verkauf über Kaufland Polen', soll: 10002, haben: 4320, taxKey: '240', euLand: 'PL', euRate: '0.23' }
  },
  {
    id: 'IT',
    name: 'Italy',
    indicators: ['Data della fattura', 'Italien', 'Italy', 'Italia'], 
    currency: 'EUR',
    keywords: { date: 'Data\\s*della\\s*fattura\\s*:?', number: 'Numero\\s*fattura\\s*:?', amount: 'Prezzo\\s*totale' },
    booking: { text: 'Verkauf über Kaufland Italien', soll: 10002, haben: 4320, taxKey: '240', euLand: 'IT', euRate: '0.22' }
  },
  {
    id: 'FR',
    name: 'France',
    indicators: ['Date de facture', 'Frankreich', 'France', 'République Française'], 
    currency: 'EUR',
    keywords: { date: 'Date\\s*(?:de)?\\s*facture', number: '(?:Num[ée.]ro|N[°o.]|Facture\\s*N[°o.]?)\\s*(?:de)?\\s*facture\\s*:?', amount: '(?:Prix\\s+|Montant\\s+)?total' },
    booking: { text: 'Verkauf über Kaufland Frankreich', soll: 10002, haben: 4320, taxKey: '240', euLand: 'AT', euRate: '0.2' }
  },
  {
    id: 'SK',
    name: 'Slovakia',
    indicators: ['Dátum faktúry', 'Datum faktury', 'Slowakei', 'Slovakia', 'Slovenská'],
    currency: 'EUR',
    keywords: { 
      date: 'tum\\s*fak', 
      number: '(?:[ČC.]+[íi.]slo\\s*fakt[úu.]r[ya.]?|Fakt[úu.]ra\\s*[čc.]|Fakt[úu.]ra)', 
      // FIX: Celkov.*?cena erfasst alles zwischen "Celkov" und "cena" (z.B. Celková cena)
      amount: '(?:Celkov.*?cena|Celkov.*?suma|K\\s*úhrade|Fakturovaná\\s*suma)' 
    },
    booking: { text: 'Verkauf über Kaufland Slowakei', soll: 10002, haben: 4320, taxKey: '240', euLand: 'SK', euRate: '0.23' }
  },
  {
    id: 'AT',
    name: 'Austria',
    indicators: ['Österreich', 'Austria'], 
    currency: 'EUR',
    keywords: { date: 'Rechnungsdatum', number: 'Rechnungsnummer', amount: 'Gesamtpreis' },
    booking: { text: 'Verkauf über Kaufland Österreich', soll: 10002, haben: 4320, taxKey: '240', euLand: 'AT', euRate: '0.2' }
  },
  {
    id: 'DE',
    name: 'Germany',
    indicators: ['Deutschland', 'Germany'],
    currency: 'EUR',
    keywords: { date: 'Rechnungsdatum', number: 'Rechnungsnummer', amount: 'Gesamtpreis' },
    booking: { text: 'Verkauf über Kaufland Deutschland', soll: 10002, haben: 4400, taxKey: '', euLand: 'DE', euRate: '0.19' }
  }
];

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [debugMode, setDebugMode] = useState(false);
  const [lastProcessedText, setLastProcessedText] = useState("");
  const [pdfLib, setPdfLib] = useState(null);
  
  const [showSettings, setShowSettings] = useState(false);
  const [rates, setRates] = useState(() => {
    const saved = localStorage.getItem('exchangeRates');
    return saved ? JSON.parse(saved) : DEFAULT_RATES;
  });

  if (!app) return <div className="p-8 text-red-800">Firebase Config fehlt!</div>;

  useEffect(() => {
    localStorage.setItem('exchangeRates', JSON.stringify(rates));
  }, [rates]);

  useEffect(() => {
    signInAnonymously(auth).catch(console.error);
    onAuthStateChanged(auth, u => { setUser(u); setLoading(false); });
    loadPdfJs().then(setPdfLib).catch(console.error);
  }, []);

  useEffect(() => {
    if (!user) { setInvoices([]); return; }
    const q = collection(db, 'artifacts', appId, 'users', user.uid, 'invoices');
    return onSnapshot(q, snap => {
      const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setInvoices(data);
    }, err => setError("DB Fehler: " + err.message));
  }, [user]);

  const handleDelete = async (id) => {
    if (window.confirm("Löschen?")) deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'invoices', id));
  };

  const handleDeleteAll = async () => {
    if (!user || invoices.length === 0) return;
    if (window.confirm(`Alle ${invoices.length} löschen?`)) {
      setProcessing(true);
      try {
        const batch = writeBatch(db);
        invoices.slice(0, 500).forEach(inv => batch.delete(doc(db, 'artifacts', appId, 'users', user.uid, 'invoices', inv.id)));
        await batch.commit();
      } catch (err) { setError("Fehler: " + err.message); }
      setProcessing(false);
    }
  };

  const processInvoice = async (file) => {
    if (!pdfLib) return;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfLib.getDocument({ data: arrayBuffer, cMapUrl: 'https://unpkg.com/pdfjs-dist@3.11.174/cmaps/', cMapPacked: true });
      const pdf = await loadingTask.promise;
      const page = await pdf.getPage(1);
      const textContent = await page.getTextContent();
      
      const textItems = textContent.items.map(i => i.str);
      const text = textItems.join('\n');
      const singleLineText = textItems.join(' ');
      
      setLastProcessedText(text);

      // 1. Detect Country
      let matchedRule = null;
      if (/Datum\s*faktury/i.test(text)) matchedRule = COUNTRY_RULES.find(r => r.id === 'CZ');
      else if (/Data\s*faktury|Numer\s*rachunku/i.test(text)) matchedRule = COUNTRY_RULES.find(r => r.id === 'PL');
      else if (/Data\s*della\s*fattura/i.test(text)) matchedRule = COUNTRY_RULES.find(r => r.id === 'IT');
      else if (/Date\s*(?:de)?\s*facture/i.test(text)) matchedRule = COUNTRY_RULES.find(r => r.id === 'FR');
      else if (/D[áa.]tum\s*(?:vyhotovenia|fakt[úu.]ry)/i.test(text) || /tum\s*fak/i.test(text)) matchedRule = COUNTRY_RULES.find(r => r.id === 'SK');
      else if (/Rechnungsdatum/i.test(text)) {
        matchedRule = (/Österreich|Austria/i.test(text)) ? COUNTRY_RULES.find(r => r.id === 'AT') : COUNTRY_RULES.find(r => r.id === 'DE');
      }
      
      if (!matchedRule) {
        if (/Italia|Italy|Italien/i.test(text)) matchedRule = COUNTRY_RULES.find(r => r.id === 'IT');
        else if (/France|Frankreich|République/i.test(text)) matchedRule = COUNTRY_RULES.find(r => r.id === 'FR');
        else if (/Slovakia|Slowakei|Slovenská/i.test(text)) matchedRule = COUNTRY_RULES.find(r => r.id === 'SK');
        else if (/Polska|Poland/i.test(text)) matchedRule = COUNTRY_RULES.find(r => r.id === 'PL');
        else if (/Česká|Czech/i.test(text)) matchedRule = COUNTRY_RULES.find(r => r.id === 'CZ');
        else if (/Austria|Österreich/i.test(text)) matchedRule = COUNTRY_RULES.find(r => r.id === 'AT');
        else matchedRule = COUNTRY_RULES.find(r => r.id === 'DE');
      }

      const data = {
        filename: file.name,
        countryId: matchedRule.id,
        currency: matchedRule.currency,
        invoiceNumber: '',
        date: '',
        amount: 0.0,
        originalAmount: 0.0,
        sollkonto: matchedRule.booking.soll,
        habenkonto: matchedRule.booking.haben,
        bookingText: matchedRule.booking.text,
        taxKey: matchedRule.booking.taxKey,
        euLand: matchedRule.booking.euLand,
        euRate: matchedRule.booking.euRate,
        createdAt: serverTimestamp()
      };

      // DATE
      const dateKey = matchedRule.keywords.date;
      const dateRegex = new RegExp(`${dateKey}.{0,40}?(\\d{4}\\s*[./-]\\s*\\d{1,2}\\s*[./-]\\s*\\d{1,2}|\\d{1,2}\\s*[./-]\\s*\\d{1,2}\\s*[./-]\\s*\\d{4}|\\d{1,2}\\.?\\s*[a-zA-ZäöüÄÖÜáčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]+\\s*\\d{4})`, 'i');
      let dateMatch = singleLineText.match(dateRegex) || text.match(dateRegex);
      if (dateMatch) data.date = standardizeDate(dateMatch[1]);
      else {
        const globalIso = text.match(/\b(\d{4})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})\b/);
        if (globalIso) data.date = standardizeDate(globalIso[0]);
      }

      // NUMBER
      const numKey = matchedRule.keywords.number;
      const strictNumRegex = new RegExp(`${numKey}.{0,40}?([A-Za-z0-9\\-/]*\\d+[A-Za-z0-9\\-/]*)`, 'i');
      let numMatch = null;
      const lines = text.split('\n');
      for (const line of lines) { numMatch = line.match(strictNumRegex); if (numMatch) break; }
      if (!numMatch) numMatch = singleLineText.match(new RegExp(`${numKey}.{0,40}?([A-Za-z0-9\\-/]*\\d+[A-Za-z0-9\\-/]*)`, 'i'));
      if (numMatch) data.invoiceNumber = numMatch[1];
      if (!data.invoiceNumber || !/^\d{8}$/.test(data.invoiceNumber)) {
        const eightDigit = text.match(/\b(\d{8})\b/);
        if (eightDigit && (!data.invoiceNumber || data.invoiceNumber.length < 3)) data.invoiceNumber = eightDigit[1];
      }

      // AMOUNT & CONVERSION
      const amountKey = matchedRule.keywords.amount;
      let amountMatch = null;
      
      // 1. Line Search with Regex
      for (const line of lines) {
         if (new RegExp(amountKey, 'i').test(line)) {
           const numbers = line.match(/([\d.,\s]+)/g);
           if (numbers && numbers.length > 0) {
             for (let i = numbers.length - 1; i >= 0; i--) {
                const valStr = numbers[i].trim();
                if (line.includes(valStr + '%')) continue;
                if (valStr.length > 1) {
                    amountMatch = [valStr, valStr]; 
                    break;
                }
             }
           }
           if (amountMatch) break;
         }
      }

      // 2. Global Fallback
      if (!amountMatch) {
         const amountRegex = new RegExp(`${amountKey}.{0,60}?([\\d.,\s]+)(?:\\s*[€A-ZKčzł]*)`, 'i');
         amountMatch = singleLineText.match(amountRegex);
      }

      if (amountMatch) {
        const val = parseCurrency(amountMatch[1]);
        data.originalAmount = val;
        
        if (matchedRule.currency === 'Kč') { 
          data.amount = val / rates.CZK;
        } else if (matchedRule.currency === 'zł') { 
          data.amount = val / rates.PLN;
        } else {
          data.amount = val;
        }
      }

      if (user) await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'invoices'), data);
    } catch (err) { setError(`Fehler bei ${file.name}: ${err.message}`); }
  };

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    setProcessing(true); setError(null); setLastProcessedText("");
    try { await Promise.all(files.map(processInvoice)); } 
    catch (err) { console.error(err); setError("Batch Fehler."); } 
    finally { setProcessing(false); e.target.value = null; }
  };

  const downloadCSV = () => {
    if (invoices.length === 0) return;
    const headers = ['Land', 'Belegdatum', 'Belegnummer', 'Buchungstext', 'Buchungsbetrag (EUR)', 'Original', 'Währ.', 'Soll', 'Haben', 'Steuer', 'EU Land', 'EU %'];
    const rows = invoices.map(inv => [
      inv.countryId, inv.date, inv.invoiceNumber, inv.bookingText, 
      inv.amount.toFixed(2).replace('.', ','), 
      inv.originalAmount ? inv.originalAmount.toFixed(2).replace('.', ',') : '',
      inv.currency || 'EUR',
      inv.sollkonto, inv.habenkonto, inv.taxKey || '', inv.euLand, inv.euRate
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(';'), ...rows.map(e => e.join(';'))].join('\n');
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", "buchungsliste_export.csv");
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  if (loading) return <div className="flex h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-blue-600" /></div>;
  if (!user) return <div className="flex h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-blue-600" /></div>;

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-900">
      
      {/* SETTINGS MODAL */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Währungskurse (EUR Basis)</h3>
              <button onClick={() => setShowSettings(false)} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5"/></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">CZK Kurs (1 EUR = ? Kč)</label>
                <input 
                  type="number" 
                  step="0.000001" 
                  value={rates.CZK} 
                  onChange={(e) => setRates({...rates, CZK: parseFloat(e.target.value)})}
                  className="w-full rounded-md border-gray-300 shadow-sm p-2 border"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">PLN Kurs (1 EUR = ? zł)</label>
                <input 
                  type="number" 
                  step="0.000001" 
                  value={rates.PLN} 
                  onChange={(e) => setRates({...rates, PLN: parseFloat(e.target.value)})}
                  className="w-full rounded-md border-gray-300 shadow-sm p-2 border"
                />
              </div>
              <button onClick={() => setShowSettings(false)} className="w-full mt-4 flex items-center justify-center gap-2 bg-blue-600 text-white rounded-lg py-2 hover:bg-blue-700">
                <Save className="h-4 w-4" /> Speichern & Schließen
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2">
            <FileText className="h-6 w-6 text-blue-600" />
            <h1 className="text-xl font-bold">InvoiceAuto SaaS <span className="text-xs bg-gray-100 px-2 py-1 rounded ml-2">MULTI-CURRENCY</span></h1>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setShowSettings(true)} className="flex items-center gap-2 rounded-md bg-gray-100 px-3 py-2 text-sm font-medium hover:bg-gray-200">
              <Settings className="h-4 w-4" /> Kurse
            </button>
            <button onClick={() => setDebugMode(!debugMode)} className={`p-2 rounded-md ${debugMode ? 'bg-blue-50 text-blue-600' : 'text-gray-400 hover:bg-gray-100'}`}><Bug className="h-5 w-5"/></button>
            <button onClick={() => signOut(auth)} className="p-2 text-gray-400 hover:bg-gray-100 rounded-md"><LogOut className="h-5 w-5"/></button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8">
        {debugMode && (
          <div className="mb-8 rounded-xl bg-gray-900 p-4 text-gray-100 shadow-lg overflow-hidden">
            <div className="flex justify-between border-b border-gray-700 pb-2 mb-2"><span className="text-green-400 font-mono text-sm">DEBUG LOG</span><X className="h-4 w-4 cursor-pointer" onClick={()=>setDebugMode(false)}/></div>
            <pre className="max-h-40 overflow-y-auto font-mono text-xs text-gray-400">{lastProcessedText}</pre>
          </div>
        )}

        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div className="rounded-xl bg-white p-5 shadow-sm border border-gray-100">
            <p className="text-sm text-gray-500">Gesamt Volumen (EUR)</p>
            <p className="text-2xl font-bold mt-1">{invoices.reduce((acc, curr) => acc + (curr.amount || 0), 0).toFixed(2)} €</p>
          </div>
          <div className="rounded-xl bg-white p-5 shadow-sm border border-gray-100">
            <p className="text-sm text-gray-500">Aktueller Kurs CZK</p>
            <p className="text-2xl font-bold mt-1 text-indigo-600">{rates.CZK.toFixed(4)}</p>
          </div>
          <div className="rounded-xl bg-white p-5 shadow-sm border border-gray-100">
            <p className="text-sm text-gray-500">Aktueller Kurs PLN</p>
            <p className="text-2xl font-bold mt-1 text-indigo-600">{rates.PLN.toFixed(4)}</p>
          </div>
          <div className="rounded-xl bg-indigo-600 p-5 shadow-sm text-white flex flex-col justify-center gap-2">
            <button onClick={downloadCSV} disabled={invoices.length===0} className="w-full flex justify-center items-center gap-2 bg-white/20 hover:bg-white/30 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"><Download className="h-4 w-4"/> CSV Export</button>
            <button onClick={handleDeleteAll} disabled={invoices.length===0} className="w-full flex justify-center items-center gap-2 bg-red-500/80 hover:bg-red-500 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"><Trash2 className="h-4 w-4"/> Alle Löschen</button>
          </div>
        </div>

        <div className="mb-8 p-8 border-2 border-dashed border-gray-300 rounded-xl bg-white text-center hover:border-blue-400 transition">
          <Upload className="h-10 w-10 text-blue-500 mx-auto mb-4"/>
          <h3 className="text-lg font-medium text-gray-900">Rechnungen hier ablegen</h3>
          <p className="text-sm text-gray-500 mb-6">PDF (DE, AT, IT, FR, CZ, PL)</p>
          <input type="file" multiple accept="application/pdf" onChange={handleFileUpload} className="hidden" id="upload" disabled={processing}/>
          <label htmlFor="upload" className="cursor-pointer bg-blue-600 text-white px-6 py-2.5 rounded-lg font-semibold hover:bg-blue-700 shadow-sm disabled:opacity-50">
            {processing ? 'Verarbeite...' : 'Dateien auswählen'}
          </label>
          {error && <div className="mt-4 text-sm text-red-600 flex items-center justify-center gap-2"><AlertCircle className="h-4 w-4"/>{error}</div>}
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {['Land', 'Datum', 'Beleg Nr.', 'Betrag (EUR)', 'Original', 'Soll / Haben', 'EU Info', ''].map(h => <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {invoices.length === 0 ? <tr><td colSpan="8" className="px-6 py-12 text-center text-gray-500">Keine Daten vorhanden.</td></tr> : invoices.map(inv => (
                  <tr key={inv.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-bold text-gray-700">{inv.countryId}</td>
                    <td className="px-6 py-4 text-sm">{inv.date}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{inv.invoiceNumber}</td>
                    <td className="px-6 py-4 text-sm font-bold text-gray-900">{inv.amount.toFixed(2)} €</td>
                    <td className="px-6 py-4 text-sm text-gray-400">
                      {inv.originalAmount ? `${inv.originalAmount.toFixed(2)} ${inv.currency}` : '-'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">{inv.sollkonto} / {inv.habenkonto}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{inv.euLand} ({inv.euRate})</td>
                    <td className="px-6 py-4 text-right">
                      <button onClick={() => handleDelete(inv.id)} className="text-red-400 hover:text-red-600"><Trash2 className="h-4 w-4"/></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
