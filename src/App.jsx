import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  signInWithPopup,
  GoogleAuthProvider,
  signOut, 
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  addDoc, 
  getDocs,
  doc,
  deleteDoc
} from 'firebase/firestore';

// ==========================================
// FIREBASE SETUP
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyAfdChbALT2e7SO0QK07bevbYy91-h_D60",
  authDomain: "study-time-tracker-9d613.firebaseapp.com",
  projectId: "study-time-tracker-9d613",
  storageBucket: "study-time-tracker-9d613.firebasestorage.app",
  messagingSenderId: "914541276146",
  appId: "1:914541276146:web:562436e67274f26b09996b"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = 'study-tracker-app-id';
const googleProvider = new GoogleAuthProvider();

export default function App() {
  // --- UI States ---
  const [activeTab, setActiveTab] = useState('record');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // --- Timer States ---
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [isTimerPaused, setIsTimerPaused] = useState(false);
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const [startTime, setStartTime] = useState(null);
  const [pauseOffset, setPauseOffset] = useState(0); 
  const [pauseStartTime, setPauseStartTime] = useState(null); 
  const [selectedSubject, setSelectedSubject] = useState('一般・その他');
  const [memo, setMemo] = useState('');
  const timerRef = useRef(null);

  // --- Data States (ハイブリッド保存) ---
  // 💡 起動時は、まず一番安全なPC内のローカル保存データを1秒で読み込みます
  const [studyRecords, setStudyRecords] = useState(() => {
    const localData = localStorage.getItem('study_records_secure_v2');
    return localData ? JSON.parse(localData) : [];
  });
  
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth()); 
  const [selectedDayDetail, setSelectedDayDetail] = useState(null);

  // データの変更を検知したら、即座にPC内に保存（絶対にデータが消えない防壁）
  useEffect(() => {
    localStorage.setItem('study_records_secure_v2', JSON.stringify(studyRecords));
  }, [studyRecords]);

  // --- Notification Helper ---
  const showNotification = (msg, isError = false) => {
    if (isError) {
      setErrorMsg(msg);
      setTimeout(() => setErrorMsg(''), 5000);
    } else {
      setSuccessMsg(msg);
      setTimeout(() => setSuccessMsg(''), 4000);
    }
  };

  // ==========================================
  // AUTHENTICATION & CLOUD SYNC
  // ==========================================
  useEffect(() => {
    setAuthLoading(true);
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        // 💡 クラウドに接続できたら、クラウド側のデータも安全に統合する
        try {
          const recordsCollection = collection(db, 'artifacts', appId, 'users', currentUser.uid, 'records');
          const snapshot = await getDocs(recordsCollection);
          if (!snapshot.empty) {
            const cloudRecords = [];
            snapshot.forEach((doc) => {
              cloudRecords.push({ id: doc.id, ...doc.data() });
            });
            // 重複を防ぎつつ、最新データをマージ
            setStudyRecords(prev => {
              const combined = [...prev];
              cloudRecords.forEach(cr => {
                if (!combined.some(p => p.id === cr.id || p.createdAt === cr.createdAt)) {
                  combined.push(cr);
                }
              });
              return combined.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            });
          }
        } catch (e) {
          console.log("Cloud sync skipped due to security block, using local storage securely.");
        }
      } else {
        signInAnonymously(auth).then((result) => setUser(result.user)).catch(() => {});
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleGoogleLogin = async () => {
    try {
      setAuthLoading(true);
      const result = await signInWithPopup(auth, googleProvider);
      setUser(result.user);
      showNotification("Googleアカウントでログインしました！");
    } catch (error) {
      showNotification("Googleログインに失敗しました。", true);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setUser(null);
      showNotification("ログアウトしました（ゲストモード）");
    } catch (error) {
      showNotification("ログアウトに失敗しました", true);
    }
  };

  // ==========================================
  // TIMER EFFECTS & FUNCTIONS
  // ==========================================
  useEffect(() => {
    if (isTimerRunning && !isTimerPaused) {
      timerRef.current = setInterval(() => {
        if (startTime) {
          const now = Date.now();
          const totalElapsed = Math.floor((now - startTime.getTime() - pauseOffset) / 1000);
          setSecondsElapsed(totalElapsed >= 0 ? totalElapsed : 0);
        }
      }, 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [isTimerRunning, isTimerPaused, startTime, pauseOffset]);

  const startTimer = () => {
    if (isTimerRunning && !isTimerPaused) return;
    if (!isTimerPaused) {
      setStartTime(new Date());
      setSecondsElapsed(0);
      setPauseOffset(0);
      setPauseStartTime(null);
    }
    setIsTimerRunning(true);
    setIsTimerPaused(false);
  };

  const pauseTimer = () => {
    if (!isTimerRunning) return;
    setPauseStartTime(new Date());
    setIsTimerPaused(true);
  };

  const resumeTimer = () => {
    if (pauseStartTime) {
      const pausedDuration = new Date().getTime() - pauseStartTime.getTime();
      setPauseOffset((prev) => prev + pausedDuration);
    }
    setPauseStartTime(null);
    setIsTimerPaused(false);
  };

  // 💡 保存処理：PC内には確実に保存し、通信ができればクラウドにも送る
  const stopAndSaveTimer = async () => {
    if (!isTimerRunning) return;
    clearInterval(timerRef.current);

    const endTime = new Date();
    const durationMinutes = Math.max(1, Math.round(secondsElapsed / 60)); 
    const now = new Date();
    const recordId = 'rec_' + Date.now();

    const newRecord = {
      id: recordId,
      subject: selectedSubject,
      duration: durationMinutes, 
      seconds: secondsElapsed,
      memo: memo.trim(),
      startTimeString: startTime ? startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
      endTimeString: endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      createdAt: now.toISOString(), 
      year: now.getFullYear(),
      month: now.getMonth(), 
      day: now.getDate(),
    };

    // 1. まず手元のPC内に一瞬で保存（絶対にフリーズしない）
    setStudyRecords(prev => [newRecord, ...prev]);

    setIsTimerRunning(false);
    setIsTimerPaused(false);
    setSecondsElapsed(0);
    setStartTime(null);
    setPauseOffset(0);
    setPauseStartTime(null);
    setMemo('');
    showNotification(`勉強時間を記録しました！ (${durationMinutes}分)`);

    // 2. 裏側でクラウド（Firebase）への保存をトライ（失敗してもローカルにあるので安全）
    if (user) {
      try {
        const recordsCollection = collection(db, 'artifacts', appId, 'users', user.uid, 'records');
        await addDoc(recordsCollection, newRecord);
        console.log("Cloud backup success!");
      } catch (e) {
        console.log("Cloud backup skipped due to firewall/network issue. Local data is safe.");
      }
    }
  };

  const cancelTimer = () => {
    if (confirm("タイマーを破棄しますか？")) {
      clearInterval(timerRef.current);
      setIsTimerRunning(false);
      setIsTimerPaused(false);
      setSecondsElapsed(0);
      setStartTime(null);
      setPauseOffset(0);
      setPauseStartTime(null);
      setMemo('');
    }
  };

  const deleteRecord = async (recordId) => {
    if (!confirm("この勉強記録を削除しますか？")) return;
    
    const updatedList = studyRecords.filter(r => r.id !== recordId);
    setStudyRecords(updatedList);
    showNotification("記録を削除しました。");
    
    if (selectedDayDetail) {
      const currentDayRecords = updatedList.filter(r => r.year === currentYear && r.month === currentMonth && r.day === selectedDayDetail.day);
      if (currentDayRecords.length === 0) {
        setSelectedDayDetail(null);
      } else {
        setSelectedDayDetail({
          ...selectedDayDetail,
          records: currentDayRecords,
          totalMinutes: currentDayRecords.reduce((sum, r) => sum + r.duration, 0)
        });
      }
    }

    // 裏側でクラウドからも削除を試みる
    if (user) {
      try {
        const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'records', recordId);
        await deleteDoc(docRef);
      } catch(e) {}
    }
  };

  // ==========================================
  // CALENDAR GENERATION HELPERS
  // ==========================================
  const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year, month) => new Date(year, month, 1).getDay();

  const prevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const nextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  const getRecordsForDate = (day) => {
    return studyRecords.filter(record => record.year === currentYear && record.month === currentMonth && record.day === day);
  };

  // ==========================================
  // TIME FORMAT HELPERS
  // ==========================================
  const formatTime = (totalSeconds) => {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatMinutesToHours = (totalMinutes) => {
    if (totalMinutes < 60) return `${totalMinutes}分`;
    const hrs = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return mins > 0 ? `${hrs}時間${mins}分` : `${hrs}時間`;
  };

  const overallTotalMinutes = studyRecords.reduce((acc, curr) => acc + (curr.duration || 0), 0);
  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDayIndex = getFirstDayOfMonth(currentYear, currentMonth);
  
  const calendarCells = [];
  for (let i = 0; i < firstDayIndex; i++) calendarCells.push(null);
  for (let d = 1; d <= daysInMonth; d++) calendarCells.push(d);

  const handleNavItemClick = (tabName) => {
    setActiveTab(tabName);
    if (window.innerWidth < 1024) setIsSidebarOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans flex flex-col selection:bg-teal-500 selection:text-white">
      {successMsg && <div className="fixed top-4 right-4 z-50 bg-teal-600 text-white px-5 py-3 rounded-lg shadow-2xl flex items-center gap-2 border border-teal-400 animate-bounce"><span>📓</span> {successMsg}</div>}
      {errorMsg && <div className="fixed top-4 right-4 z-50 bg-rose-600 text-white px-5 py-3 rounded-lg shadow-2xl flex items-center gap-2 border border-rose-400"><span>⚠️</span> {errorMsg}</div>}

      <header className="h-14 bg-slate-950 border-b border-slate-800 flex items-center justify-between px-4 sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 hover:bg-slate-800 rounded-lg text-slate-300 transition-colors focus:outline-none">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.0} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" /></svg>
          </button>
          <div className="flex items-center gap-2"><span className="text-2xl">📓</span><span className="font-bold text-lg bg-gradient-to-r from-teal-400 to-indigo-400 bg-clip-text text-transparent">Study Log</span></div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {authLoading ? (
            <div className="w-4 h-4 border-2 border-teal-500 border-t-transparent rounded-full animate-spin"></div>
          ) : user && !user.isAnonymous ? (
            <div className="flex items-center gap-3 bg-slate-900 border border-slate-700 py-1 px-3 rounded-full">
              {user.photoURL ? <img src={user.photoURL} alt="User" className="w-5 h-5 rounded-full" /> : <span className="text-teal-400">👤</span>}
              <span className="max-w-[120px] truncate text-xs text-slate-200 hidden md:inline">{user.displayName || 'Google ユーザー'}</span>
              <button onClick={handleLogout} className="text-xs text-rose-400 hover:text-rose-300 transition-colors">ログアウト</button>
            </div>
          ) : (
            <button onClick={handleGoogleLogin} className="bg-teal-600 hover:bg-teal-500 text-white font-semibold py-1.5 px-3.5 rounded-full text-xs flex items-center gap-2 transition-all shadow-md">
              <span>Google連携で保存</span>
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-1 relative overflow-hidden">
        <aside className={`absolute lg:static top-0 left-0 h-full bg-slate-950 border-r border-slate-800/80 w-64 z-30 transition-all duration-300 ease-in-out flex flex-col justify-between ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:w-0 lg:border-r-0 lg:overflow-hidden'}`}>
          <div className="p-4 flex flex-col gap-2">
            <div className="mb-4 p-3 bg-slate-900 rounded-xl border border-slate-800/80">
              <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">データ保存先</p>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                <span className="text-xs font-bold">ハイブリッド保存（安全稼働中）</span>
              </div>
            </div>
            <nav className="flex flex-col gap-1">
              <button onClick={() => handleNavItemClick('record')} className={`flex items-center gap-3.5 px-4 py-3 rounded-xl transition-all font-medium text-sm ${activeTab === 'record' ? 'bg-slate-800 text-teal-400 border-l-4 border-teal-500' : 'text-slate-300 hover:bg-slate-900'}`}>⏱️ 勉強を記録する</button>
              <button onClick={() => handleNavItemClick('gallery')} className={`flex items-center gap-3.5 px-4 py-3 rounded-xl transition-all font-medium text-sm ${activeTab === 'gallery' ? 'bg-slate-800 text-teal-400 border-l-4 border-teal-500' : 'text-slate-300 hover:bg-slate-900'}`}>📅 ギャラリー・カレンダー</button>
            </nav>
          </div>
          <div className="p-4 border-t border-slate-900">
            <div className="bg-gradient-to-br from-slate-900 to-slate-950 p-4 rounded-xl border border-slate-800">
              <div className="text-[10px] text-slate-400 font-bold tracking-wider uppercase">累計総勉強時間</div>
              <div className="text-xl font-extrabold text-teal-400 mt-1">{formatMinutesToHours(overallTotalMinutes)}</div>
              <div className="text-[10px] text-slate-500 mt-1">{studyRecords.length}個の記録</div>
            </div>
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto bg-slate-900 p-4 md:p-8">
          {activeTab === 'record' ? (
            <div className="max-w-xl mx-auto space-y-6">
              <div className="text-center mb-2">
                <span className="inline-block bg-teal-500/10 text-teal-400 border border-teal-500/30 text-xs px-3.5 py-1.5 rounded-full font-bold uppercase tracking-widest">📓 Focus Session 📓</span>
                <h1 className="text-2xl md:text-3xl font-extrabold text-slate-100 mt-2">勉強時間の記録</h1>
              </div>

              <div className="bg-slate-950 border border-slate-800/80 rounded-2xl p-6 md:p-8 shadow-xl flex flex-col items-center relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-teal-500 via-indigo-500 to-pink-500"></div>
                <div className="relative w-48 h-48 md:w-56 md:h-56 rounded-full border-4 border-slate-800 flex flex-col items-center justify-center bg-slate-900/60 shadow-inner">
                  <span className="text-[10px] text-teal-400 font-bold uppercase tracking-wider mb-1">{isTimerRunning ? (isTimerPaused ? '一時停止中' : '計測中') : '準備完了'}</span>
                  <span className="text-3xl md:text-4xl font-mono font-bold text-slate-100">{formatTime(secondsElapsed)}</span>
                </div>

                <div className="w-full mt-8 flex flex-col sm:flex-row gap-3 justify-center items-center">
                  {!isTimerRunning ? (
                    <button onClick={startTimer} className="w-full sm:w-48 bg-gradient-to-r from-teal-500 to-emerald-500 text-slate-950 font-extrabold py-3.5 px-6 rounded-xl text-center shadow-lg transform active:scale-95 transition-all">▶ 開始する</button>
                  ) : (
                    <div className="w-full flex flex-col sm:flex-row gap-3">
                      {isTimerPaused ? (
                        <button onClick={resumeTimer} className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 px-6 rounded-xl">▶ 再開</button>
                      ) : (
                        <button onClick={pauseTimer} className="flex-1 bg-amber-600 hover:bg-amber-500 text-white font-bold py-3 px-6 rounded-xl">⏸️ 一時停止</button>
                      )}
                      <button onClick={stopAndSaveTimer} className="flex-1 bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold py-3 px-6 rounded-xl shadow-lg">⏱️ 終了して記録</button>
                      <button onClick={cancelTimer} className="sm:w-16 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-400 py-3 px-4 rounded-xl">❌</button>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-slate-950 border border-slate-800/80 rounded-2xl p-6 shadow-md space-y-4">
                <h3 className="text-base font-bold text-slate-300 border-b border-slate-800 pb-2">記録用オプション設定</h3>
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1.5 uppercase tracking-wide">📖 科目を選択</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {['英語', '数学・算数', '国語', '理科・科学', '社会・歴史', '資格・プログラミング', '読書', '一般・その他'].map((subj) => (
                      <button key={subj} onClick={() => setSelectedSubject(subj)} className={`py-2 px-3 text-xs rounded-lg font-semibold transition-all border ${selectedSubject === subj ? 'bg-teal-950/40 text-teal-400 border-teal-500/80' : 'bg-slate-900 text-slate-300 border-slate-800'}`}>{subj}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1.5 uppercase tracking-wide">✏️ メモ (任意)</label>
                  <textarea rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="学習内容など..." className="w-full bg-slate-900 border border-slate-800 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 rounded-lg p-3 text-sm text-slate-100 placeholder-slate-500 outline-none resize-none"></textarea>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">最近の学習履歴</h3>
                {studyRecords.length === 0 ? (
                  <div className="bg-slate-950/50 text-slate-500 py-6 text-center text-sm rounded-xl border border-dashed border-slate-800">まだ記録はありません。</div>
                ) : (
                  <div className="space-y-2">
                    {studyRecords.slice(0, 3).map((record) => (
                      <div key={record.id} className="bg-slate-950 border border-slate-800/80 rounded-xl p-3.5 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-xl">📓</span>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300">{record.subject}</span>
                              <span className="text-[10px] text-slate-400">{record.month !== undefined && record.day !== undefined ? `${record.month + 1}/${record.day}` : ''}</span>
                            </div>
                            <p className="text-xs text-slate-400 mt-1 max-w-[200px] truncate">{record.memo || "メモなし"}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-extrabold text-teal-400">{record.duration}分</div>
                          <button onClick={() => deleteRecord(record.id)} className="text-[10px] text-rose-400 hover:text-rose-300 mt-1">削除</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row gap-4 items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold flex items-center gap-2"><span>📅</span><span>学習ギャラリー</span></h2>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={prevMonth} className="p-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-lg text-slate-300">◀ 先月</button>
                  <span className="text-lg font-extrabold font-mono text-slate-100 px-2 min-w-[120px] text-center">{currentYear}年 {currentMonth + 1}月</span>
                  <button onClick={nextMonth} className="p-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-lg text-slate-300">来月 ▶</button>
                </div>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 md:p-6 shadow-xl overflow-hidden">
                <div className="grid grid-cols-7 gap-1 md:gap-2 mb-2 text-center text-xs font-bold uppercase tracking-wider">
                  <div className="text-rose-400 py-2">日</div><div className="text-slate-400 py-2">月</div><div className="text-slate-400 py-2">火</div><div className="text-slate-400 py-2">水</div><div className="text-slate-400 py-2">木</div><div className="text-slate-400 py-2">金</div><div className="text-teal-400 py-2">土</div>
                </div>
                <div className="grid grid-cols-7 gap-1.5 md:gap-2.5">
                  {calendarCells.map((day, idx) => {
                    if (day === null) return <div key={`empty-${idx}`} className="bg-slate-950/20 aspect-square rounded-xl"></div>;
                    const recordsForThisDay = getRecordsForDate(day);
                    const totalMin = recordsForThisDay.reduce((sum, r) => sum + r.duration, 0);
                    let intensityClass = "bg-slate-900 border border-slate-800/80";
                    if (totalMin > 0 && totalMin <= 30) intensityClass = "bg-teal-950/30 border border-teal-900 text-teal-300";
                    else if (totalMin > 30 && totalMin <= 90) intensityClass = "bg-teal-950/60 border border-teal-800/80 text-teal-200";
                    else if (totalMin > 90) intensityClass = "bg-teal-900/40 border border-teal-500/60 text-teal-100";
                    return (
                      <button key={`day-${day}`} onClick={() => {
                        if (recordsForThisDay.length > 0) {
                          setSelectedDayDetail({ day, records: recordsForThisDay, totalMinutes: totalMin });
                        } else {
                          showNotification(`${currentMonth + 1}月${day}日の記録はありません。`);
                        }
                      }} className={`aspect-square p-1.5 rounded-xl flex flex-col justify-between items-start ${intensityClass}`}>
                        <span className="text-xs font-bold opacity-80">{day}</span>
                        {totalMin > 0 ? <div className="w-full text-right mt-auto"><span className="text-[9px] font-extrabold bg-teal-500/20 text-teal-400 px-1 py-0.5 rounded">{totalMin}分</span></div> : <span className="text-[9px] text-slate-700 mt-auto block">-</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              {selectedDayDetail && (
                <div className="bg-slate-950 border-2 border-teal-500/30 rounded-2xl p-5 md:p-6 shadow-2xl relative">
                  <button onClick={() => setSelectedDayDetail(null)} className="absolute top-4 right-4 text-slate-400 text-sm font-bold p-2 bg-slate-900 rounded-full">✕</button>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800 pb-3 mb-4">
                    <div>
                      <h3 className="text-lg font-bold text-teal-400 flex items-center gap-2"><span>📅</span><span>{currentYear}年{currentMonth + 1}月{selectedDayDetail.day}日の学習内容</span></h3>
                    </div>
                    <div className="mt-2 sm:mt-0"><span className="text-xs text-slate-400">1日の総計: </span><span className="text-base font-extrabold text-teal-400 bg-teal-500/10 px-3 py-1 rounded-full">{formatMinutesToHours(selectedDayDetail.totalMinutes)}</span></div>
                  </div>
                  <div className="space-y-3 max-h-[300px] overflow-y-auto">
                    {selectedDayDetail.records.map((record) => (
                      <div key={record.id} className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="bg-teal-950 text-teal-400 border border-teal-900 text-[10px] px-2.5 py-0.5 rounded font-extrabold">{record.subject}</span>
                            {record.startTimeString && <span className="text-[10px] text-slate-500 font-mono">{record.startTimeString} 〜 {record.endTimeString}</span>}
                          </div>
                          {record.memo ? <p className="text-sm text-slate-200 mt-1 bg-slate-950/40 p-2 rounded-lg">{record.memo}</p> : <p className="text-xs text-slate-500 italic">メモはありません</p>}
                        </div>
                        <div className="flex sm:flex-col items-center sm:items-end justify-between border-t sm:border-t-0 border-slate-800/60 pt-2 sm:pt-0">
                          <div className="text-lg font-extrabold text-teal-400 font-mono">{record.duration}分</div>
                          <button onClick={() => deleteRecord(record.id)} className="text-xs text-rose-400 mt-1">削除する</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
      <footer className="bg-slate-950 border-t border-slate-900 py-3 text-center text-[10px] text-slate-500">&copy; 2026 Study Log App - Built with React</footer>
    </div>
  );
}