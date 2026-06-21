import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithCustomToken, 
  signInAnonymously, 
  signInWithPopup,
  GoogleAuthProvider,
  signOut, 
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  getFirestore, 
  doc, 
  setDoc, 
  getDoc, 
  collection, 
  addDoc, 
  query, 
  onSnapshot, 
  deleteDoc,
  orderBy
} from 'firebase/firestore';

// ==========================================
// FIREBASE SETUP
// ==========================================
// 💡 ご自身のFirebaseプロジェクトの設定値をここに貼り付けます。
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

// Google Auth Provider
const googleProvider = new GoogleAuthProvider();

export default function App() {
  // --- UI States ---
  const [activeTab, setActiveTab] = useState('record'); // 'record' | 'gallery'
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
  const [selectedSubject, setSelectedSubject] = useState('一般・その他');
  const [memo, setMemo] = useState('');
  const timerRef = useRef(null);

  // --- Data States ---
  const [studyRecords, setStudyRecords] = useState([]);
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth()); // 0-11
  const [selectedDayDetail, setSelectedDayDetail] = useState(null); // 日付選択時の詳細ポップアップ

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
  // AUTHENTICATION (RULE 3)
  // ==========================================
  useEffect(() => {
    const initAuth = async () => {
      try {
        setAuthLoading(true);
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          // デフォルトは匿名ログイン。Google連携はUIから行えます
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Auth init error:", error);
        showNotification("認証の初期化に失敗しました。再読み込みしてください。", true);
      } finally {
        setAuthLoading(false);
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Google Login Function
  const handleGoogleLogin = async () => {
    try {
      setAuthLoading(true);
      await signInWithPopup(auth, googleProvider);
      showNotification("Googleアカウントでログインしました！");
    } catch (error) {
      console.error("Google login error:", error);
      showNotification("Googleログインに失敗しました。" + error.message, true);
    } finally {
      setAuthLoading(false);
    }
  };

  // Logout Function
  const handleLogout = async () => {
    try {
      await signOut(auth);
      // ログアウト後は再度匿名ログイン
      await signInAnonymously(auth);
      showNotification("ログアウトしました（ゲストモードに移行）");
    } catch (error) {
      showNotification("ログアウトに失敗しました", true);
    }
  };

  // ==========================================
  // FIRESTORE DATA FETCHING (RULE 1 & 2)
  // ==========================================
  useEffect(() => {
    if (!user) return;

    // RULE 1: /artifacts/{appId}/users/{userId}/{collectionName}
    const recordsCollection = collection(db, 'artifacts', appId, 'users', user.uid, 'records');
    
    // RULE 2: 複合クエリを避け、単純なクエリで全件取得してJS側で並び替えや集計を行います
    const unsubscribe = onSnapshot(recordsCollection, (snapshot) => {
      const loadedRecords = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        loadedRecords.push({
          id: doc.id,
          ...data,
          // FirestoreのTimestampオブジェクトかISO文字列かを考慮してDateに変換
          date: data.createdAt ? new Date(data.createdAt) : new Date(),
        });
      });

      // JSメモリ上で日付順（降順）にソート
      loadedRecords.sort((a, b) => b.date - a.date);
      setStudyRecords(loadedRecords);
    }, (error) => {
      console.error("Firestore read error:", error);
      showNotification("データの同期に失敗しました。", true);
    });

    return () => unsubscribe();
  }, [user]);

  // ==========================================
  // TIMER FUNCTIONS
  // ==========================================
  const startTimer = () => {
    if (isTimerRunning && !isTimerPaused) return;
    
    if (!isTimerPaused) {
      setStartTime(new Date());
      setSecondsElapsed(0);
    }
    setIsTimerRunning(true);
    setIsTimerPaused(false);

    timerRef.current = setInterval(() => {
      setSecondsElapsed((prev) => prev + 1);
    }, 1000);
  };

  const pauseTimer = () => {
    if (!isTimerRunning) return;
    clearInterval(timerRef.current);
    setIsTimerPaused(true);
  };

  const resumeTimer = () => {
    startTimer();
  };

  const stopAndSaveTimer = async () => {
    if (!isTimerRunning) return;
    clearInterval(timerRef.current);

    const endTime = new Date();
    const durationMinutes = Math.max(1, Math.round(secondsElapsed / 60)); // 最低1分として記録

    // 保存データオブジェクト
    const newRecord = {
      subject: selectedSubject,
      duration: durationMinutes, // 分単位
      seconds: secondsElapsed,
      memo: memo.trim(),
      startTimeString: startTime ? startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
      endTimeString: endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      createdAt: new Date().toISOString(), // フィルタリングと表示のためのISO文字列
      year: new Date().getFullYear(),
      month: new Date().getMonth(), // 0-11
      day: new Date().getDate(),
    };

    try {
      if (!user) {
        showNotification("ログインユーザーが見つかりません。一時的にローカルのみに保存します（保存されません）。", true);
        return;
      }

      // RULE 1 に基づき保存
      const recordsCollection = collection(db, 'artifacts', appId, 'users', user.uid, 'records');
      await addDoc(recordsCollection, newRecord);

      // フォームのクリアと状態リセット
      setIsTimerRunning(false);
      setIsTimerPaused(false);
      setSecondsElapsed(0);
      setStartTime(null);
      setMemo('');
      showNotification(`勉強時間を記録しました！ (${durationMinutes}分)`);
    } catch (error) {
      console.error("Save error:", error);
      showNotification("データの保存に失敗しました。", true);
    }
  };

  const cancelTimer = () => {
    if (confirm("タイマーを破棄しますか？ 現在の計測データは保存されません。")) {
      clearInterval(timerRef.current);
      setIsTimerRunning(false);
      setIsTimerPaused(false);
      setSecondsElapsed(0);
      setStartTime(null);
      setMemo('');
    }
  };

  // ==========================================
  // DATA MANAGEMENT (DELETE)
  // ==========================================
  const deleteRecord = async (recordId) => {
    if (!confirm("この勉強記録を削除しますか？")) return;

    try {
      const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'records', recordId);
      await deleteDoc(docRef);
      showNotification("記録を削除しました。");
      
      // ポップアップが開いていれば更新
      if (selectedDayDetail) {
        const updatedList = selectedDayDetail.records.filter(r => r.id !== recordId);
        if (updatedList.length === 0) {
          setSelectedDayDetail(null);
        } else {
          setSelectedDayDetail({
            ...selectedDayDetail,
            records: updatedList,
            totalMinutes: updatedList.reduce((sum, r) => sum + r.duration, 0)
          });
        }
      }
    } catch (error) {
      console.error("Delete error:", error);
      showNotification("記録の削除に失敗しました。", true);
    }
  };

  // ==========================================
  // CALENDAR GENERATION HELPERS
  // ==========================================
  const getDaysInMonth = (year, month) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (year, month) => {
    return new Date(year, month, 1).getDay(); // 0 (Sun) to 6 (Sat)
  };

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

  // 特定の日付の全記録を抽出する
  const getRecordsForDate = (day) => {
    return studyRecords.filter(record => {
      const rDate = new Date(record.createdAt);
      return rDate.getFullYear() === currentYear &&
             rDate.getMonth() === currentMonth &&
             rDate.getDate() === day;
    });
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
    if (totalMinutes < 60) {
      return `${totalMinutes}分`;
    }
    const hrs = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return mins > 0 ? `${hrs}時間${mins}分` : `${hrs}時間`;
  };

  // 全期間の総勉強時間を計算
  const overallTotalMinutes = studyRecords.reduce((acc, curr) => acc + (curr.duration || 0), 0);

  // カレンダーマスの描画用配列作成
  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDayIndex = getFirstDayOfMonth(currentYear, currentMonth);
  
  const calendarCells = [];
  // 空白セル (前月の残り)
  for (let i = 0; i < firstDayIndex; i++) {
    calendarCells.push(null);
  }
  // 今月の日付セル
  for (let d = 1; d <= daysInMonth; d++) {
    calendarCells.push(d);
  }

  // サイドバー項目タップ時の動作
  const handleNavItemClick = (tabName) => {
    setActiveTab(tabName);
    // モバイル幅など画面サイズを想定し、項目がタップされたらサイドバーを閉じる
    if (window.innerWidth < 1024) {
      setIsSidebarOpen(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans flex flex-col selection:bg-teal-500 selection:text-white">
      
      {/* 画面上部のトーストメッセージ */}
      {successMsg && (
        <div className="fixed top-4 right-4 z-50 bg-teal-600 text-white px-5 py-3 rounded-lg shadow-2xl flex items-center gap-2 border border-teal-400 transition-all duration-300 animate-bounce">
          <span>📓</span> {successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="fixed top-4 right-4 z-50 bg-rose-600 text-white px-5 py-3 rounded-lg shadow-2xl flex items-center gap-2 border border-rose-400 transition-all duration-300">
          <span>⚠️</span> {errorMsg}
        </div>
      )}

      {/* ヘッダーエリア */}
      <header className="h-14 bg-slate-950 border-b border-slate-800 flex items-center justify-between px-4 sticky top-0 z-40">
        <div className="flex items-center gap-3">
          {/* Gemini風サイドバー開閉トグル */}
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-2 hover:bg-slate-800 rounded-lg text-slate-300 transition-colors focus:outline-none"
            title="サイドバーを切り替え"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.0} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
            </svg>
          </button>
          
          <div className="flex items-center gap-2">
            <span className="text-2xl">📓</span>
            <span className="font-bold text-lg bg-gradient-to-r from-teal-400 to-indigo-400 bg-clip-text text-transparent">
              Study Log
            </span>
          </div>
        </div>

        {/* ユーザーアカウント & ログイン情報 */}
        <div className="flex items-center gap-3 text-sm">
          {authLoading ? (
            <div className="w-4 h-4 border-2 border-teal-500 border-t-transparent rounded-full animate-spin"></div>
          ) : user && !user.isAnonymous ? (
            <div className="flex items-center gap-3 bg-slate-900 border border-slate-700 py-1 px-3 rounded-full">
              {user.photoURL ? (
                <img src={user.photoURL} alt={user.displayName} className="w-5 h-5 rounded-full" />
              ) : (
                <span className="text-teal-400">👤</span>
              )}
              <span className="max-w-[120px] truncate text-xs text-slate-200 hidden md:inline">{user.displayName || 'Google ユーザー'}</span>
              <button 
                onClick={handleLogout}
                className="text-xs text-rose-400 hover:text-rose-300 transition-colors"
                title="ログアウト"
              >
                ログアウト
              </button>
            </div>
          ) : (
            <button
              onClick={handleGoogleLogin}
              className="bg-teal-600 hover:bg-teal-500 text-white font-semibold py-1.5 px-3.5 rounded-full text-xs flex items-center gap-2 transition-all shadow-md hover:shadow-teal-900/30"
            >
              <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                <path d="M12.24 10.285V13.4h6.887C18.2 15.614 15.645 18 12.24 18c-3.86 0-7-3.14-7-7s3.14-7 7-7c1.71 0 3.27.61 4.5 1.64l2.44-2.44C17.3 1.51 14.93 1 12.24 1c-6.075 0-11 4.925-11 11s4.925 11 11 11c5.54 0 10.21-3.96 10.21-11 0-.685-.08-1.325-.21-1.715H12.24z"/>
              </svg>
              <span>Google連携で保存</span>
            </button>
          )}
        </div>
      </header>

      {/* メインレイアウト */}
      <div className="flex flex-1 relative overflow-hidden">
        
        {/* スライド式サイドバー（Gemini風） */}
        <aside className={`
          absolute lg:static top-0 left-0 h-full bg-slate-950 border-r border-slate-800/80 w-64 z-30 transition-all duration-300 ease-in-out flex flex-col justify-between
          ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:w-0 lg:border-r-0 lg:overflow-hidden'}
        `}>
          <div className="p-4 flex flex-col gap-2">
            
            {/* アカウント状態表示 */}
            <div className="mb-4 p-3 bg-slate-900 rounded-xl border border-slate-800/80">
              <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">データ保存先</p>
              <div className="flex items-center gap-2 mt-1.5">
                <span className={`w-2.5 h-2.5 rounded-full ${user && !user.isAnonymous ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`}></span>
                <span className="text-xs font-bold">
                  {user && !user.isAnonymous ? 'Google クラウド同期中' : '一時保存（ゲストモード）'}
                </span>
              </div>
              {user?.isAnonymous && (
                <p className="text-[10px] text-amber-400/80 mt-1">Google連携すると、他のデバイスでもデータが引き継げます。</p>
              )}
            </div>

            {/* ナビゲーションメニュー */}
            <nav className="flex flex-col gap-1">
              <button
                onClick={() => handleNavItemClick('record')}
                className={`flex items-center gap-3.5 px-4 py-3 rounded-xl transition-all font-medium text-sm ${
                  activeTab === 'record' 
                    ? 'bg-slate-800 text-teal-400 border-l-4 border-teal-500 shadow-inner' 
                    : 'text-slate-300 hover:bg-slate-900'
                }`}
              >
                <span className="text-lg">⏱️</span>
                <span>勉強を記録する</span>
              </button>

              <button
                onClick={() => handleNavItemClick('gallery')}
                className={`flex items-center gap-3.5 px-4 py-3 rounded-xl transition-all font-medium text-sm ${
                  activeTab === 'gallery' 
                    ? 'bg-slate-800 text-teal-400 border-l-4 border-teal-500 shadow-inner' 
                    : 'text-slate-300 hover:bg-slate-900'
                }`}
              >
                <span className="text-lg">📅</span>
                <span>ギャラリー・カレンダー</span>
              </button>
            </nav>
          </div>

          {/* 総勉強時間ウィジェット */}
          <div className="p-4 border-t border-slate-900">
            <div className="bg-gradient-to-br from-slate-900 to-slate-950 p-4 rounded-xl border border-slate-800">
              <div className="text-[10px] text-slate-400 font-bold tracking-wider uppercase">累計総勉強時間</div>
              <div className="text-xl font-extrabold text-teal-400 mt-1">
                {formatMinutesToHours(overallTotalMinutes)}
              </div>
              <div className="text-[10px] text-slate-500 mt-1">{studyRecords.length}個の記録</div>
            </div>
          </div>
        </aside>

        {/* メインコンテンツ表示エリア */}
        <main className="flex-1 overflow-y-auto bg-slate-900 p-4 md:p-8">
          
          {activeTab === 'record' ? (
            /* ==========================================
               勉強時間記録セクション (TIMER)
               ========================================== */
            <div className="max-w-xl mx-auto space-y-6">
              
              <div className="text-center mb-2">
                <span className="inline-block bg-teal-500/10 text-teal-400 border border-teal-500/30 text-xs px-3.5 py-1.5 rounded-full font-bold uppercase tracking-widest">
                  📓 Focus Session 📓
                </span>
                <h1 className="text-2xl md:text-3xl font-extrabold text-slate-100 mt-2">勉強時間の記録</h1>
                <p className="text-sm text-slate-400 mt-1">開始ボタンを押して集中をスタートしましょう。</p>
              </div>

              {/* タイマーカード */}
              <div className="bg-slate-950 border border-slate-800/80 rounded-2xl p-6 md:p-8 shadow-xl flex flex-col items-center relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-teal-500 via-indigo-500 to-pink-500"></div>

                {/* タイマーサークル */}
                <div className="relative w-48 h-48 md:w-56 md:h-56 rounded-full border-4 border-slate-800 flex flex-col items-center justify-center bg-slate-900/60 shadow-inner group transition-transform duration-500 hover:scale-[1.02]">
                  {/* 外周のアニメーションサークル */}
                  {isTimerRunning && !isTimerPaused && (
                    <div className="absolute inset-0 rounded-full border-4 border-teal-500 animate-ping opacity-10"></div>
                  )}
                  
                  <span className="text-[10px] text-teal-400 font-bold uppercase tracking-wider mb-1">
                    {isTimerRunning ? (isTimerPaused ? '一時停止中' : '計測中') : '準備完了'}
                  </span>
                  
                  <span className="text-3xl md:text-4xl font-mono font-bold text-slate-100 transition-all duration-300">
                    {formatTime(secondsElapsed)}
                  </span>
                  
                  <span className="text-xs text-slate-500 mt-2">
                    {startTime ? `開始: ${startTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}` : '時間表示'}
                  </span>
                </div>

                {/* 各種コントロールボタン */}
                <div className="w-full mt-8 flex flex-col sm:flex-row gap-3 justify-center items-center">
                  {!isTimerRunning ? (
                    <button
                      onClick={startTimer}
                      className="w-full sm:w-48 bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-400 hover:to-emerald-400 text-slate-950 font-extrabold py-3.5 px-6 rounded-xl text-center shadow-lg shadow-teal-500/20 transform active:scale-95 transition-all text-base"
                    >
                      ▶ 開始する
                    </button>
                  ) : (
                    <div className="w-full flex flex-col sm:flex-row gap-3">
                      {isTimerPaused ? (
                        <button
                          onClick={resumeTimer}
                          className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 px-6 rounded-xl transition-all"
                        >
                          ▶ 再開
                        </button>
                      ) : (
                        <button
                          onClick={pauseTimer}
                          className="flex-1 bg-amber-600 hover:bg-amber-500 text-white font-bold py-3 px-6 rounded-xl transition-all"
                        >
                          ⏸️ 一時停止
                        </button>
                      )}

                      <button
                        onClick={stopAndSaveTimer}
                        className="flex-1 bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold py-3 px-6 rounded-xl shadow-lg shadow-teal-500/10 transition-all"
                      >
                        ⏱️ 終了して記録
                      </button>

                      <button
                        onClick={cancelTimer}
                        className="sm:w-16 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-400 hover:text-rose-400 py-3 px-4 rounded-xl transition-all"
                        title="計測を破棄"
                      >
                        ❌
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* 記録用オプション情報（タイマー動作中でも変更可能） */}
              <div className="bg-slate-950 border border-slate-800/80 rounded-2xl p-6 shadow-md space-y-4">
                <h3 className="text-base font-bold text-slate-300 border-b border-slate-800 pb-2">記録用オプション設定</h3>
                
                {/* 勉強科目タグのセレクト */}
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1.5 uppercase tracking-wide">
                    📖 勉強内容・科目を選択
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {['英語', '数学・算数', '国語', '理科・科学', '社会・歴史', '資格・プログラミング', '読書', '一般・その他'].map((subj) => (
                      <button
                        key={subj}
                        onClick={() => setSelectedSubject(subj)}
                        className={`py-2 px-3 text-xs rounded-lg font-semibold transition-all border ${
                          selectedSubject === subj 
                            ? 'bg-teal-950/40 text-teal-400 border-teal-500/80 shadow-md' 
                            : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        {subj}
                      </button>
                    ))}
                  </div>
                </div>

                {/* メモ書き */}
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1.5 uppercase tracking-wide">
                    ✏️ メモ・ひとこと日記 (任意)
                  </label>
                  <textarea
                    rows={2}
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    placeholder="学習した内容、教材名、感想などを記入できます..."
                    className="w-full bg-slate-900 border border-slate-800 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 rounded-lg p-3 text-sm text-slate-100 placeholder-slate-500 outline-none transition-all resize-none"
                  ></textarea>
                </div>
              </div>

              {/* 最近の学習レコード(ショートカット確認) */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">最近の学習履歴</h3>
                  <button onClick={() => setActiveTab('gallery')} className="text-xs text-teal-400 hover:underline">カレンダーで全て見る →</button>
                </div>

                {studyRecords.length === 0 ? (
                  <div className="bg-slate-950/50 text-slate-500 py-6 text-center text-sm rounded-xl border border-dashed border-slate-800">
                    まだ記録はありません。
                  </div>
                ) : (
                  <div className="space-y-2">
                    {studyRecords.slice(0, 3).map((record) => (
                      <div key={record.id} className="bg-slate-950 border border-slate-800/80 rounded-xl p-3.5 flex items-center justify-between hover:border-slate-700 transition-all">
                        <div className="flex items-center gap-3">
                          <span className="text-xl">📓</span>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300">{record.subject}</span>
                              <span className="text-[10px] text-slate-400">
                                {record.date ? `${record.date.getMonth() + 1}/${record.date.getDate()}` : ''}
                              </span>
                            </div>
                            <p className="text-xs text-slate-400 mt-1 max-w-[200px] sm:max-w-xs truncate">{record.memo || "メモなし"}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-extrabold text-teal-400">{record.duration}分</div>
                          <button 
                            onClick={() => deleteRecord(record.id)} 
                            className="text-[10px] text-rose-400 hover:text-rose-300 transition-all mt-1 opacity-60 hover:opacity-100"
                          >
                            削除
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          ) : (
            /* ==========================================
               ギャラリーカレンダーセクション (GALLERY)
               ========================================== */
            <div className="max-w-4xl mx-auto space-y-6">
              
              {/* 月間ヘッダーとナビゲーション */}
              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row gap-4 items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold flex items-center gap-2">
                    <span>📅</span>
                    <span>学習ギャラリー</span>
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">日付を選ぶとその日の学習時間と詳細なメモを確認できます。</p>
                </div>

                <div className="flex items-center gap-3">
                  <button 
                    onClick={prevMonth}
                    className="p-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-lg text-slate-300 transition-all"
                  >
                    ◀ 先月
                  </button>
                  <span className="text-lg font-extrabold font-mono text-slate-100 px-2 min-w-[120px] text-center">
                    {currentYear}年 {currentMonth + 1}月
                  </span>
                  <button 
                    onClick={nextMonth}
                    className="p-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-lg text-slate-300 transition-all"
                  >
                    来月 ▶
                  </button>
                </div>
              </div>

              {/* カレンダーグリッド */}
              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 md:p-6 shadow-xl overflow-hidden">
                
                {/* 曜日ヘッダー */}
                <div className="grid grid-cols-7 gap-1 md:gap-2 mb-2 text-center text-xs font-bold uppercase tracking-wider">
                  <div className="text-rose-400 py-2">日</div>
                  <div className="text-slate-400 py-2">月</div>
                  <div className="text-slate-400 py-2">火</div>
                  <div className="text-slate-400 py-2">水</div>
                  <div className="text-slate-400 py-2">木</div>
                  <div className="text-slate-400 py-2">金</div>
                  <div className="text-teal-400 py-2">土</div>
                </div>

                {/* 日付マス */}
                <div className="grid grid-cols-7 gap-1.5 md:gap-2.5">
                  {calendarCells.map((day, idx) => {
                    if (day === null) {
                      return <div key={`empty-${idx}`} className="bg-slate-950/20 aspect-square rounded-xl"></div>;
                    }

                    // この日の全勉強履歴
                    const recordsForThisDay = getRecordsForDate(day);
                    const totalMin = recordsForThisDay.reduce((sum, r) => sum + r.duration, 0);

                    // 勉強時間がある日の背景カラー度合い
                    let intensityClass = "bg-slate-900 hover:bg-slate-850 border border-slate-800/80";
                    if (totalMin > 0 && totalMin <= 30) intensityClass = "bg-teal-950/30 border border-teal-900 text-teal-300 hover:bg-teal-900/30";
                    else if (totalMin > 30 && totalMin <= 90) intensityClass = "bg-teal-950/60 border border-teal-800/80 text-teal-200 hover:bg-teal-900/40";
                    else if (totalMin > 90) intensityClass = "bg-teal-900/40 border border-teal-500/60 text-teal-100 hover:bg-teal-900/60";

                    return (
                      <button
                        key={`day-${day}`}
                        onClick={() => {
                          if (recordsForThisDay.length > 0) {
                            setSelectedDayDetail({
                              day,
                              records: recordsForThisDay,
                              totalMinutes: totalMin
                            });
                          } else {
                            // 勉強時間がない場合、新規にその日を設定して記録画面へ移る導線等
                            showNotification(`${currentMonth + 1}月${day}日の記録はありません。`);
                          }
                        }}
                        className={`aspect-square p-1.5 md:p-2 rounded-xl flex flex-col justify-between items-start transition-all duration-200 text-left ${intensityClass}`}
                      >
                        <span className="text-xs md:text-sm font-bold opacity-80">{day}</span>
                        {totalMin > 0 ? (
                          <div className="w-full text-right mt-auto">
                            <span className="text-[9px] md:text-xs font-extrabold bg-teal-500/20 text-teal-400 px-1 py-0.5 rounded md:inline-block">
                              {totalMin}分
                            </span>
                          </div>
                        ) : (
                          <span className="text-[9px] text-slate-700 mt-auto block">-</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 日別の詳細履歴ポップアップ（カレンダー下部表示） */}
              {selectedDayDetail && (
                <div className="bg-slate-950 border-2 border-teal-500/30 rounded-2xl p-5 md:p-6 shadow-2xl relative transition-all animate-fadeIn">
                  
                  {/* クローズボタン */}
                  <button 
                    onClick={() => setSelectedDayDetail(null)}
                    className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 text-sm font-bold p-2 bg-slate-900 hover:bg-slate-800 rounded-full"
                  >
                    ✕
                  </button>

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800 pb-3 mb-4">
                    <div>
                      <h3 className="text-lg font-bold text-teal-400 flex items-center gap-2">
                        <span>📓</span>
                        <span>{currentYear}年{currentMonth + 1}月{selectedDayDetail.day}日の学習内容</span>
                      </h3>
                      <p className="text-xs text-slate-400 mt-1">この日に登録されたすべての勉強ログ</p>
                    </div>
                    <div className="mt-2 sm:mt-0">
                      <span className="text-xs text-slate-400">1日の総計: </span>
                      <span className="text-base font-extrabold text-teal-400 bg-teal-500/10 px-3 py-1 rounded-full border border-teal-500/20">
                        {formatMinutesToHours(selectedDayDetail.totalMinutes)}
                      </span>
                    </div>
                  </div>

                  {/* 該当日の記録リスト */}
                  <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
                    {selectedDayDetail.records.map((record) => (
                      <div key={record.id} className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-slate-700 transition-all">
                        
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="bg-teal-950 text-teal-400 border border-teal-900 text-[10px] px-2.5 py-0.5 rounded font-extrabold uppercase">
                              {record.subject}
                            </span>
                            {record.startTimeString && (
                              <span className="text-[10px] text-slate-500 font-mono">
                                {record.startTimeString} 〜 {record.endTimeString}
                              </span>
                            )}
                          </div>
                          {record.memo ? (
                            <p className="text-sm text-slate-200 mt-1 font-medium bg-slate-950/40 p-2 rounded-lg border border-slate-900">
                              {record.memo}
                            </p>
                          ) : (
                            <p className="text-xs text-slate-500 italic">メモはありません</p>
                          )}
                        </div>

                        <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center border-t sm:border-t-0 border-slate-800/60 pt-2 sm:pt-0">
                          <div className="text-lg font-extrabold text-teal-400 font-mono">{record.duration}分</div>
                          <button
                            onClick={() => deleteRecord(record.id)}
                            className="text-xs text-rose-400 hover:text-rose-300 hover:underline mt-1 cursor-pointer transition-colors"
                          >
                            削除する
                          </button>
                        </div>

                      </div>
                    ))}
                  </div>

                </div>
              )}

              {/* お祝いメッセージ / ガイド */}
              <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 rounded-2xl p-6 border border-slate-800 text-center">
                <span className="text-3xl block mb-2">🎉</span>
                <h4 className="text-sm font-bold text-slate-300">継続は力なり</h4>
                <p className="text-xs text-slate-400 max-w-lg mx-auto mt-1">
                  毎日コツコツ勉強した時間は嘘をつきません。カレンダーをみどり色のマスで埋められるように頑張りましょう！
                </p>
              </div>

            </div>
          )}

        </main>
      </div>

      {/* フッター */}
      <footer className="bg-slate-950 border-t border-slate-900 py-3 text-center text-[10px] text-slate-500">
        &copy; 2026 Study Log App - Built with React & Firebase
      </footer>

    </div>
  );
}