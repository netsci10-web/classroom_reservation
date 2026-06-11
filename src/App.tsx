import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInAnonymously,
  onAuthStateChanged,
  signOut,
  User,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  setDoc,
  onSnapshot,
  collection,
  getDocFromServer
} from 'firebase/firestore';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Settings,
  Plus,
  Trash2,
  Lock,
  User as UserIcon,
  Check,
  X,
  LogOut,
  RefreshCw,
  Sliders,
  Clock,
  Sparkles,
  MapPin,
  Mail,
  AlertCircle,
  BookOpen
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// ==========================================
// 1. Firebase 설정 및 초기화
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyDThKVXOGiGiNfPb2GlyO64GY6-_nq2Iuw",
  authDomain: "classroom-reservation-79b25.firebaseapp.com",
  projectId: "classroom-reservation-79b25",
  storageBucket: "classroom-reservation-79b25.firebasestorage.app",
  messagingSenderId: "723240372847",
  appId: "1:723240372847:web:e5be76e16401aef2319b9a",
  measurementId: "G-600EC9MKNJ"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// 관리자 권한을 부여할 지정 UID 목록
const ADMIN_UIDS = [
  'U2qTJ1dAQXfAiOZ3knMmujGSqKU2', // 구글 로그인 계정 (netsci10@gmail.com)
  'Tu0UHRz4flZDndTWshxDI8DKFVn2'  // 익명 로그인 지정 관리자 계정 
];

// ==========================================
// 2. 타입 정의 (Types)
// ==========================================
interface Period {
  id: number;
  name: string;
  startTime: string;
  endTime: string;
  allowed: boolean;
}

interface AppSettings {
  appName: string;
  appDescription: string;
  copyright: string;
  contactEmail: string;
  specialRooms: string[];
  classes: string[];
  periods: Period[];
}

interface Reservation {
  teacherClass: string;
  teacherName: string;
  memo: string;
  reservedByUid: string;
  reservedByName: string;
  createdAt: string;
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

// 렌더링에 적합한 기본 설정 값 (초기 구동 / 클린 데이터베이스 폴백용)
const defaultSettings: AppSettings = {
  appName: "마산중앙초등학교 특별실 예약시스템",
  appDescription: "학교의 일과표 시간을 기반으로 관리하는 실시간 특별실 공유 및 예약 웹 서비스입니다.",
  copyright: "© 2026 마산중앙초등학교. All rights reserved.",
  contactEmail: "netsci10@gmail.com",
  specialRooms: ["과학실", "컴퓨터실", "영어교실", "창의체육실", "보건교육실", "슬기샘도서실"],
  classes: [
    "1학년 1반", "1학년 2반", "2학년 1반", "2학년 2반", 
    "3학년 1반", "3학년 2반", "4학년 1반", "4학년 2반", 
    "5학년 1반", "5학년 2반", "6학년 1반", "6학년 2반", 
    "전담 영어", "전담 과학", "보건교사", "돌봄교실", "도서담당교사"
  ],
  periods: [
    { id: 1, name: "1교시", startTime: "09:00", endTime: "09:40", allowed: true },
    { id: 2, name: "2교시", startTime: "09:50", endTime: "10:30", allowed: true },
    { id: 3, name: "3교시", startTime: "10:40", endTime: "11:20", allowed: true },
    { id: 4, name: "4교시", startTime: "11:30", endTime: "12:10", allowed: true },
    { id: 5, name: "5교시", startTime: "13:00", endTime: "13:40", allowed: true },
    { id: 6, name: "6교시", startTime: "13:50", endTime: "14:30", allowed: true },
    { id: 7, name: "7교시", startTime: "14:40", endTime: "15:20", allowed: false }
  ]
};

// ==========================================
// 3. 에러 핸들러 (Firestore Error Standard Helpers)
// ==========================================
function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error Payload: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// ==========================================
// Main React Component
// ==========================================
export default function App() {
  const appId = "classroom-reservation-79b25";

  // ------------------------------------------
  // 상태 관리 (State Definitions)
  // ------------------------------------------
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [authLoading, setAuthLoading] = useState<boolean>(true);

  // Firebase 이메일/비밀번호 로그인 상태 (Email/Password Auth States)
  const [inputEmail, setInputEmail] = useState<string>('');
  const [inputPassword, setInputPassword] = useState<string>('');
  const [inputDisplayName, setInputDisplayName] = useState<string>('');
  const [isRegisterMode, setIsRegisterMode] = useState<boolean>(false);
  const [authErrorMsg, setAuthErrorMsg] = useState<string | null>(null);

  // 설정 및 데이터
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [settingsLoading, setSettingsLoading] = useState<boolean>(true);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  
  // 예약 상태 정보
  const [dailyReservations, setDailyReservations] = useState<Record<string, Reservation>>({});
  const [dailyLoading, setDailyLoading] = useState<boolean>(false);
  const [allReservationsMap, setAllReservationsMap] = useState<Record<string, boolean>>({}); // YYYY-MM-DD => true/false (달력 도트 표시용)

  // 상호작용 관련 (UI Interaction States)
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [adminSectionTab, setAdminSectionTab] = useState<'info' | 'rooms' | 'classes' | 'periods'>('info');
  const [activeBookingCell, setActiveBookingCell] = useState<{ room: string; period: Period } | null>(null);
  const [showReservationDetail, setShowReservationDetail] = useState<{ room: string; period: Period; res: Reservation } | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [savingStatus, setSavingStatus] = useState<string | null>(null);

  // 예약 폼 입력 상태
  const [formClass, setFormClass] = useState<string>('');
  const [formTeacher, setFormTeacher] = useState<string>('');
  const [formMemo, setFormMemo] = useState<string>('');

  // 설정 편집용 로컬 상태
  const [editGeneral, setEditGeneral] = useState({
    appName: '',
    appDescription: '',
    copyright: '',
    contactEmail: ''
  });
  const [newRoomInput, setNewRoomInput] = useState<string>('');
  const [newClassInput, setNewClassInput] = useState<string>('');

  // 캘린더 연월 이동 상태
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());

  // ------------------------------------------
  // 의존성 분석 및 초기 구동
  // ------------------------------------------
  const selectedDateStr = selectedDate.toISOString().split('T')[0];

  // 1. Firebase Connection Validate & Auto-Authenticate Check
  useEffect(() => {
    const testConnection = async () => {
      try {
        const testDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'settings', 'config');
        await getDocFromServer(testDocRef);
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration or network status.");
        }
      }
    };
    testConnection();
  }, [appId]);

  // 2. Authentication Flow [익명 로그인 폴백 보장 설계]
  const checkIsAdmin = (user: User | null): boolean => {
    if (!user) return false;
    if (user.isAnonymous) return false;
    return ADMIN_UIDS.includes(user.uid) || 
           user.email === 'netsci10@gmail.com' || 
           user.email?.toLowerCase().includes('admin');
  };

  useEffect(() => {
    setAuthLoading(true);
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setCurrentUser(user);
        setIsAdmin(checkIsAdmin(user));
        setAuthLoading(false);
      } else {
        // 인증 유도가 풀리지 않았을 경우 혹은 커스텀 토큰 오류 방어를 위해 즉시 익명 로그인으로 우회
        try {
          const anonCred = await signInAnonymously(auth);
          setCurrentUser(anonCred.user);
          setIsAdmin(checkIsAdmin(anonCred.user));
        } catch (error) {
          console.error("익명 로그인 우회 실패:", error);
        }
        setAuthLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  // 3. Real-time Config Sync (Firestore -> React State)
  useEffect(() => {
    const settingsRef = doc(db, 'artifacts', appId, 'public', 'data', 'settings', 'config');
    setSettingsLoading(true);

    const unsub = onSnapshot(settingsRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data() as AppSettings;
        setSettings({
          appName: data.appName || defaultSettings.appName,
          appDescription: data.appDescription || defaultSettings.appDescription,
          copyright: data.copyright || defaultSettings.copyright,
          contactEmail: data.contactEmail || defaultSettings.contactEmail,
          specialRooms: data.specialRooms || defaultSettings.specialRooms,
          classes: data.classes || defaultSettings.classes,
          periods: data.periods || defaultSettings.periods
        });

        setEditGeneral({
          appName: data.appName || defaultSettings.appName,
          appDescription: data.appDescription || defaultSettings.appDescription,
          copyright: data.copyright || defaultSettings.copyright,
          contactEmail: data.contactEmail || defaultSettings.contactEmail
        });
      } else {
        // 아직 Firestore 데이터가 없을 때 로컬 기본값 적용 후, 관리자 로그인을 통한 데이터 저장을 지원
        setSettings(defaultSettings);
        setEditGeneral({
          appName: defaultSettings.appName,
          appDescription: defaultSettings.appDescription,
          copyright: defaultSettings.copyright,
          contactEmail: defaultSettings.contactEmail
        });
      }
      setSettingsLoading(false);
    }, (error) => {
      console.warn("설정 데이터를 불러오는 중 권한 혹은 파일 초기 상태 경고:", error);
      // fallback
      setSettings(defaultSettings);
      setSettingsLoading(false);
    });

    return () => unsub();
  }, [appId]);

  // 4. Real-time Reservations Sync for specific Date
  useEffect(() => {
    setDailyLoading(true);
    const reservationsRef = doc(db, 'artifacts', appId, 'public', 'data', 'reservations', selectedDateStr);

    const unsub = onSnapshot(reservationsRef, (docSnap) => {
      if (docSnap.exists()) {
        setDailyReservations(docSnap.data().reservations || {});
      } else {
        setDailyReservations({});
      }
      setDailyLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `reservations/${selectedDateStr}`);
      setDailyLoading(false);
    });

    return () => unsub();
  }, [selectedDateStr, appId]);

  // 5. Real-time Monthly Reservation Status (가벼운 전수 달력 도트 마킹용)
  useEffect(() => {
    const resColl = collection(db, 'artifacts', appId, 'public', 'data', 'reservations');
    const unsub = onSnapshot(resColl, (querySnap) => {
      const mapped: Record<string, boolean> = {};
      querySnap.forEach((docSnap) => {
        const reservationsMap = docSnap.data().reservations || {};
        const hasBooking = Object.keys(reservationsMap).length > 0;
        if (hasBooking) {
          mapped[docSnap.id] = true;
        }
      });
      setAllReservationsMap(mapped);
    }, (error) => {
      console.warn("달력 요약 현황 로드 권한 우회/제외 상태 :", error);
    });

    return () => unsub();
  }, [appId]);

  // ------------------------------------------
  // 로그인 및 인증 관리자 액션 (Google & Email/Password Auth Actions)
  // ------------------------------------------
  const handleGoogleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      // Multi-account selection prompt for easier switcher interaction
      provider.setCustomParameters({ prompt: 'select_account' });
      const result = await signInWithPopup(auth, provider);
      setCurrentUser(result.user);
      setIsAdmin(checkIsAdmin(result.user));
    } catch (err: any) {
      console.error("Google Auth error:", err);
      if (err.code !== 'auth/popup-closed-by-user') {
        alert(`구글 로그인 실패: ${err.message || err}`);
      }
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthErrorMsg(null);
    if (!inputEmail.trim() || !inputPassword.trim()) {
      setAuthErrorMsg("이메일과 비밀번호를 모두 입력해 주세요.");
      return;
    }
    try {
      const result = await signInWithEmailAndPassword(auth, inputEmail.trim(), inputPassword.trim());
      setCurrentUser(result.user);
      setIsAdmin(checkIsAdmin(result.user));
      setAuthErrorMsg(null);
      setInputEmail('');
      setInputPassword('');
    } catch (err: any) {
      console.error("Email login error:", err);
      let errorMsg = "로그인에 실패했습니다.";
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        errorMsg = "이메일 또는 비밀번호가 올바르지 않습니다.";
      } else if (err.code === 'auth/invalid-email') {
        errorMsg = "올바르지 않은 이메일 형식입니다.";
      }
      setAuthErrorMsg(errorMsg);
    }
  };

  const handleEmailRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthErrorMsg(null);
    if (!inputEmail.trim() || !inputPassword.trim() || !inputDisplayName.trim()) {
      setAuthErrorMsg("이메일, 비밀번호, 성함을 모두 입력해 주세요.");
      return;
    }
    if (inputPassword.length < 6) {
      setAuthErrorMsg("비밀번호는 최소 6자리 이상이어야 합니다.");
      return;
    }
    try {
      const result = await createUserWithEmailAndPassword(auth, inputEmail.trim(), inputPassword.trim());
      await updateProfile(result.user, { displayName: inputDisplayName.trim() });
      await result.user.reload();
      const updatedUser = auth.currentUser;
      if (updatedUser) {
        setCurrentUser(updatedUser);
        setIsAdmin(checkIsAdmin(updatedUser));
      }
      setAuthErrorMsg(null);
      setInputEmail('');
      setInputPassword('');
      setInputDisplayName('');
      setIsRegisterMode(false);
    } catch (err: any) {
      console.error("Email register error:", err);
      let errorMsg = "회원가입에 실패했습니다.";
      if (err.code === 'auth/email-already-in-use') {
        errorMsg = "이미 등록된 이메일 계정입니다.";
      } else if (err.code === 'auth/invalid-email') {
        errorMsg = "올바르지 않은 이메일 형식입니다.";
      }
      setAuthErrorMsg(errorMsg);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      setAuthErrorMsg(null);
      // signOut 후 onAuthStateChanged가 리스너에 의해 트리거되어 익명 로그인으로 자동 안전 폴백됩니다.
    } catch (err) {
      console.error("SignOut error:", err);
    }
  };

  // ------------------------------------------
  // 특별실 예약 등록 및 취소 액션 (Reservation Logic)
  // ------------------------------------------
  const openBookingForm = (room: string, period: Period) => {
    const compoundKey = `${room}_${period.id}`;
    const existing = dailyReservations[compoundKey];

    if (existing) {
      // 기존 예약이 있다면 상세 모달 표출
      setShowReservationDetail({ room, period, res: existing });
    } else {
      // 신규 예약 폼 초기화 및 팝업 개방
      setFormClass(settings.classes[0] || '');
      setFormTeacher(currentUser?.displayName || currentUser?.email?.split('@')[0] || '');
      setFormMemo('');
      setActiveBookingCell({ room, period });
    }
  };

  const saveReservation = async () => {
    if (!activeBookingCell) return;
    if (!formTeacher.trim()) {
      alert("예약하시는 분(교사명)을 입력해주세요.");
      return;
    }

    setIsSaving(true);
    const compoundKey = `${activeBookingCell.room}_${activeBookingCell.period.id}`;
    
    const newReservation: Reservation = {
      teacherClass: formClass,
      teacherName: formTeacher.trim(),
      memo: formMemo.trim(),
      reservedByUid: currentUser?.uid || 'anonymous',
      reservedByName: currentUser?.displayName || '익명교사',
      createdAt: new Date().toISOString()
    };

    const updatedReservations = {
      ...dailyReservations,
      [compoundKey]: newReservation
    };

    const resPath = `reservations/${selectedDateStr}`;
    try {
      const resDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'reservations', selectedDateStr);
      await setDoc(resDocRef, { reservations: updatedReservations }, { merge: true });
      setActiveBookingCell(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, resPath);
    } finally {
      setIsSaving(false);
    }
  };

  const cancelReservation = async (room: string, periodId: number) => {
    if (!confirm("정말 이 예약을 취소하시겠습니까?")) return;

    setIsSaving(true);
    const compoundKey = `${room}_${periodId}`;
    
    const updated = { ...dailyReservations };
    delete updated[compoundKey];

    const resPath = `reservations/${selectedDateStr}`;
    try {
      const resDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'reservations', selectedDateStr);
      await setDoc(resDocRef, { reservations: updated });
      setShowReservationDetail(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, resPath);
    } finally {
      setIsSaving(false);
    }
  };

  // ------------------------------------------
  // 관리자 설정 변경 액션 (Admin Settings Logic)
  // ------------------------------------------
  const saveGeneralSettings = async () => {
    if (!isAdmin) return;
    setIsSaving(true);
    setSavingStatus("저장 중...");
    
    const settingsPath = 'settings/config';
    try {
      const settingsRef = doc(db, 'artifacts', appId, 'public', 'data', 'settings', 'config');
      await setDoc(settingsRef, {
        ...settings,
        appName: editGeneral.appName,
        appDescription: editGeneral.appDescription,
        copyright: editGeneral.copyright,
        contactEmail: editGeneral.contactEmail
      }, { merge: true });
      
      setSavingStatus("성공적으로 저장되었습니다!");
      setTimeout(() => setSavingStatus(null), 3000);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, settingsPath);
    } finally {
      setIsSaving(false);
    }
  };

  const addSpecialRoom = async () => {
    if (!isAdmin || !newRoomInput.trim()) return;
    if (settings.specialRooms.includes(newRoomInput.trim())) {
      alert("이미 존재하는 특별실 이름입니다.");
      return;
    }

    setIsSaving(true);
    const newList = [...settings.specialRooms, newRoomInput.trim()];
    try {
      const settingsRef = doc(db, 'artifacts', appId, 'public', 'data', 'settings', 'config');
      await setDoc(settingsRef, { specialRooms: newList }, { merge: true });
      setNewRoomInput('');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'settings/config');
    } finally {
      setIsSaving(false);
    }
  };

  const removeSpecialRoom = async (roomName: string) => {
    if (!isAdmin) return;
    if (!confirm(`[경고] '${roomName}' 특별실을 설정에서 완전히 제거하시겠습니까?\n해당 특별실 예약 현황이 화면에 더 이상 출력되지 않습니다.`)) return;

    setIsSaving(true);
    const newList = settings.specialRooms.filter(r => r !== roomName);
    try {
      const settingsRef = doc(db, 'artifacts', appId, 'public', 'data', 'settings', 'config');
      await setDoc(settingsRef, { specialRooms: newList }, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'settings/config');
    } finally {
      setIsSaving(false);
    }
  };

  const addClassItem = async () => {
    if (!isAdmin || !newClassInput.trim()) return;
    if (settings.classes.includes(newClassInput.trim())) {
      alert("이미 존재하는 대상(학급)입니다.");
      return;
    }

    setIsSaving(true);
    const newList = [...settings.classes, newClassInput.trim()];
    try {
      const settingsRef = doc(db, 'artifacts', appId, 'public', 'data', 'settings', 'config');
      await setDoc(settingsRef, { classes: newList }, { merge: true });
      setNewClassInput('');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'settings/config');
    } finally {
      setIsSaving(false);
    }
  };

  const removeClassItem = async (className: string) => {
    if (!isAdmin) return;
    setIsSaving(true);
    const newList = settings.classes.filter(c => c !== className);
    try {
      const settingsRef = doc(db, 'artifacts', appId, 'public', 'data', 'settings', 'config');
      await setDoc(settingsRef, { classes: newList }, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'settings/config');
    } finally {
      setIsSaving(false);
    }
  };

  const togglePeriodAllowed = async (periodId: number, currentVal: boolean) => {
    if (!isAdmin) return;
    setIsSaving(true);
    const newPeriods = settings.periods.map(p => {
      if (p.id === periodId) {
        return { ...p, allowed: !currentVal };
      }
      return p;
    });

    try {
      const settingsRef = doc(db, 'artifacts', appId, 'public', 'data', 'settings', 'config');
      await setDoc(settingsRef, { periods: newPeriods }, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'settings/config');
    } finally {
      setIsSaving(false);
    }
  };

  const modifyPeriodTime = async (periodId: number, field: 'startTime' | 'endTime' | 'name', value: string) => {
    if (!isAdmin) return;
    const newPeriods = settings.periods.map(p => {
      if (p.id === periodId) {
        return { ...p, [field]: value };
      }
      return p;
    });

    try {
      const settingsRef = doc(db, 'artifacts', appId, 'public', 'data', 'settings', 'config');
      await setDoc(settingsRef, { periods: newPeriods }, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'settings/config');
    }
  };

  // ------------------------------------------
  // 달력 렌더링 헬퍼 함수군 (Calendar Helpers)
  // ------------------------------------------
  const daysInMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  };

  const firstDayOfMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  };

  const prevMonth = () => {
    setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1));
  };

  const setToday = () => {
    const today = new Date();
    setSelectedDate(today);
    setCalendarMonth(today);
  };

  const renderCalendarDays = () => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const daysCount = daysInMonth(calendarMonth);
    const firstDay = firstDayOfMonth(calendarMonth);

    const cells = [];
    
    // 이전 달 빈칸 채우기
    for (let i = 0; i < firstDay; i++) {
      cells.push(<div key={`empty-${i}`} className="h-8 flex items-center justify-center text-xs text-slate-200" />);
    }

    // 일자 채우기
    for (let day = 1; day <= daysCount; day++) {
      const currentCellDate = new Date(year, month, day);
      const isSelected = selectedDate.getDate() === day &&
                         selectedDate.getMonth() === month &&
                         selectedDate.getFullYear() === year;
      
      const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const hasBooking = !!allReservationsMap[dateKey];
      const isToday = new Date().getDate() === day && 
                      new Date().getMonth() === month && 
                      new Date().getFullYear() === year;

      const dayOfWeek = currentCellDate.getDay();
      let textColor = 'text-slate-700 font-medium';
      if (dayOfWeek === 0) textColor = 'text-red-500 font-bold'; // 일요일
      if (dayOfWeek === 6) textColor = 'text-blue-500 font-bold'; // 토요일

      cells.push(
        <button
          key={`day-${day}`}
          onClick={() => setSelectedDate(currentCellDate)}
          className={`h-8 w-full flex flex-col items-center justify-center text-xs font-semibold border relative rounded-md transition-all cursor-pointer ${
            isSelected 
              ? 'bg-indigo-600 font-bold text-white shadow-sm border-transparent' 
              : isToday
                ? 'border-indigo-400 text-slate-900 font-extrabold bg-indigo-50/50 hover:bg-indigo-100'
                : 'border-transparent hover:bg-slate-100'
          }`}
          style={{ contentVisibility: 'auto' }}
        >
          <span className={isSelected ? 'text-white' : textColor}>{day}</span>
          {hasBooking && (
            <span className={`absolute bottom-0.5 w-1 h-1 rounded-full ${isSelected ? 'bg-amber-300' : 'bg-indigo-500'}`} />
          )}
        </button>
      );
    }

    return cells;
  };

  const getWeekDayKorean = (date: Date) => {
    const days = ["일", "월", "화", "수", "목", "금", "토"];
    return days[date.getDay()];
  };

  // ------------------------------------------
  // 통합 칼럼 요약 데이터 가공 (Integrated View Helper)
  // ------------------------------------------
  const getCombinedSummary = (periodId: number) => {
    const periodSummary: { room: string; className: string; teacher: string }[] = [];
    
    settings.specialRooms.forEach(room => {
      const key = `${room}_${periodId}`;
      const booking = dailyReservations[key];
      if (booking) {
        periodSummary.push({
          room,
          className: booking.teacherClass,
          teacher: booking.teacherName
        });
      }
    });

    return periodSummary;
  };

  return (
    <div className="h-screen w-screen bg-slate-100 flex items-center justify-center overflow-hidden p-0 sm:p-2 selection:bg-indigo-500 selection:text-white">
      <div className="w-full h-full max-w-7xl bg-slate-50 flex flex-col font-sans border border-slate-200/80 shadow-lg rounded-none sm:rounded-2xl overflow-hidden">
      
      {/* ==========================================
          A. 앱 네비게이션 & 헤더 (Header Layout)
          ========================================== */}
      <header className="h-14 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between flex-shrink-0 sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-indigo-600 rounded-lg flex items-center justify-center text-white shadow-sm flex-shrink-0">
            <BookOpen className="h-4.5 w-4.5" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-900 leading-tight flex items-center gap-1.5">
              {settings.appName}
              <span className="inline-flex bg-indigo-50 text-indigo-700 text-[9px] font-semibold px-1.5 py-0.2 rounded-full border border-indigo-100 flex-shrink-0">
                실시간 연동
              </span>
            </h1>
            <p className="text-[10px] text-slate-500 leading-none tracking-wide mt-0.5 max-w-[400px] truncate">
              {settings.appDescription}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {/* 로그인 프로필 & 로그인 버튼 */}
          <div className="flex items-center space-x-1.5 border border-slate-200 rounded-full px-2 py-1 bg-slate-100 select-none">
            {currentUser?.isAnonymous ? (
              <span className="text-[10px] text-slate-500 px-1 font-semibold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                교직원 (로그인 안 됨)
              </span>
            ) : currentUser ? (
              <div className="flex items-center space-x-1.5 pl-0.5">
                {currentUser.photoURL ? (
                  <img src={currentUser.photoURL} alt="avatar" className="w-5 h-5 rounded-full" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-5 h-5 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-700 text-[10px] font-bold">
                    {currentUser.displayName?.[0] || currentUser.email?.[0] || 'T'}
                  </div>
                )}
                <span className="text-[10px] font-bold text-slate-700 max-w-[90px] truncate">
                  {currentUser.displayName || currentUser.email?.split('@')[0] || '교사'}
                </span>
                {isAdmin ? (
                  <span className="bg-amber-500 text-white text-[8px] font-black px-1.5 py-0.2 rounded-sm shadow-xs">
                    시스템관리자
                  </span>
                ) : (
                  <span className="bg-indigo-50 border border-indigo-100 text-indigo-700 text-[8px] font-bold px-1 rounded-sm">
                    인증교사
                  </span>
                )}
              </div>
            ) : (
              <span className="text-[10px] text-slate-400 px-1">비회원</span>
            )}

            {currentUser && !currentUser.isAnonymous && (
              <button
                onClick={handleSignOut}
                title="로그아웃"
                className="p-0.5 text-slate-400 hover:text-rose-500 hover:bg-white rounded-full transition-all"
              >
                <LogOut className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* ⚙️ 관리자 설정 진입 버튼 */}
          <button
            id="settings_btn"
            onClick={() => setIsSettingsOpen(true)}
            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors border border-transparent hover:border-slate-200/60 flex items-center justify-center relative"
            title="시스템 설정"
          >
            <Settings className="w-4 h-4" />
            {isAdmin && (
              <span className="absolute top-1 right-1 w-2 h-2 bg-amber-500 rounded-full border border-white" />
            )}
          </button>
        </div>
      </header>

      {/* ==========================================
          B. 메인 대시보드 구조 (Main Content Grid)
          ========================================== */}
      <main className="flex-1 flex overflow-hidden p-4 gap-4 flex-col lg:flex-row">
        
        {/* Sidebar: Calendar & Today's Summary */}
        <aside className="w-full lg:w-[280px] flex flex-col gap-4 flex-shrink-0 overflow-y-auto lg:overflow-visible">
          
          {/* Calendar Card */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-slate-800 text-sm">{calendarMonth.getFullYear()}년 {calendarMonth.getMonth() + 1}월</h2>
              <div className="flex gap-1">
                <button 
                  onClick={prevMonth} 
                  className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button 
                  onClick={setToday} 
                  className="px-1.5 py-0.5 text-[10px] font-bold text-indigo-600 hover:bg-indigo-50 rounded transition-colors whitespace-nowrap"
                >
                  오늘
                </button>
                <button 
                  onClick={nextMonth} 
                  className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
            
            <div className="grid grid-cols-7 text-center text-[10px] font-bold text-slate-400 uppercase tracking-tighter mb-2">
              <div className="text-red-500">일</div>
              <div>월</div>
              <div>화</div>
              <div>수</div>
              <div>목</div>
              <div>금</div>
              <div className="text-blue-500">토</div>
            </div>
            
            <div className="grid grid-cols-7 gap-1">
              {renderCalendarDays()}
            </div>
          </div>

          {/* Today's Summary (오늘의 요약) Card */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex-1 flex flex-col overflow-hidden min-h-[220px]">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
              예약 요약 ({selectedDate.getMonth() + 1}월 {selectedDate.getDate()}일)
            </h3>
            <div className="space-y-2 overflow-y-auto flex-1 pr-1">
              {settings.specialRooms.map((room, roomIdx) => {
                const totalPeriods = settings.periods.filter(p => p.allowed).length;
                const bookedCount = settings.periods.filter(p => {
                  if (!p.allowed) return false;
                  const key = `${room}_${p.id}`;
                  return !!dailyReservations[key];
                }).length;

                const themes = [
                  { bg: 'bg-indigo-50 border border-indigo-100 text-indigo-700', sub: 'text-indigo-600' },
                  { bg: 'bg-emerald-50 border border-emerald-100 text-emerald-700', sub: 'text-emerald-600' },
                  { bg: 'bg-amber-50 border border-amber-100 text-amber-700', sub: 'text-amber-600' },
                  { bg: 'bg-sky-50 border border-sky-100 text-sky-700', sub: 'text-sky-650' },
                  { bg: 'bg-rose-50 border border-rose-100 text-rose-700', sub: 'text-rose-650' }
                ];
                const activeTheme = themes[roomIdx % themes.length];

                return (
                  <div key={`summary-${roomIdx}`} className={`p-2.5 rounded-lg border transition-all ${activeTheme.bg}`}>
                    <p className="text-[11px] font-bold">{room} 예약 현황</p>
                    <p className={`text-xs mt-0.5 font-semibold ${activeTheme.sub}`}>
                      {totalPeriods}개 교시 중 {bookedCount}개 예약됨
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

        </aside>

        {/* Main Matrix Section */}
        <section id="reservation_matrix_section" className="flex-1 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col overflow-hidden relative">
          
          {/* Matrix Toolbar */}
          <div className="p-3 border-b border-slate-150 flex items-center justify-between bg-slate-50/50 flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 bg-white border border-slate-200 rounded-md text-xs font-bold text-slate-700 shadow-sm flex items-center gap-1.5 font-mono">
                {selectedDate.getFullYear()}년 {selectedDate.getMonth() + 1}월 {selectedDate.getDate()}일 ({getWeekDayKorean(selectedDate)}요일)
              </span>
            </div>
            <div className="flex gap-2">
              <div className="flex items-center space-x-1 bg-indigo-50/60 rounded-md px-2 py-1 text-[10px] text-indigo-850 border border-indigo-100/50">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
                <span className="font-bold">실시간 연동</span>
              </div>
            </div>
          </div>

          {/* 로딩 인디케이터 바 */}
          {dailyLoading && (
            <div className="absolute top-0 inset-x-0 h-0.5 bg-indigo-500 animate-pulse z-10" />
          )}

          {/* 반응형 가로 스크롤 매트릭스 래퍼 (드롭다운 가려짐 원천 방어 pb-32 포함) */}
          <div className="overflow-x-auto w-full pb-32 flex-1">
            <table className="w-full border-collapse min-w-[900px]">
              <thead>
                <tr>
                  {/* 구분 헤더 */}
                  <th className="p-2 text-center text-[10px] font-bold text-slate-500 bg-slate-100/80 border border-slate-200 w-[110px]">
                    교시 / 시간
                  </th>
                  
                  {/* 실시간 특별실 리스트 헤더 */}
                  {settings.specialRooms.map((room, idx) => (
                    <th
                      key={`header-room-${idx}`}
                      className="p-2 text-center text-xs font-bold text-slate-800 bg-indigo-50/30 border border-slate-200 min-w-[130px]"
                    >
                      <div className="flex items-center justify-center gap-1.5">
                        <span className="inline-flex items-center justify-center p-1 bg-indigo-100/50 rounded text-indigo-700">
                          <MapPin className="w-3 h-3" />
                        </span>
                        <span className="text-slate-900 font-extrabold">{room}</span>
                      </div>
                    </th>
                  ))}

                  {/* 통합 관리 정보 요약 헤더 (Combined Column) */}
                  <th className="p-2 text-center text-[10px] font-extrabold text-white bg-slate-800 border border-slate-700 w-[220px]">
                    <div className="flex flex-col items-center">
                      <span className="text-indigo-300 text-[8px] uppercase font-bold tracking-wider">CONSOLIDATED</span>
                      <span>통합 현황</span>
                    </div>
                  </th>
                </tr>
              </thead>
              
              <tbody>
                {settings.periods.map((period) => (
                  <tr
                    key={`period-row-${period.id}`}
                    className={`group/row ${!period.allowed ? 'opacity-60 bg-slate-50/20' : 'hover:bg-slate-50/30'}`}
                  >
                    {/* 교시 열정보 */}
                    <td className="p-2 border border-slate-200 bg-slate-100/40 text-center">
                      <div className="font-extrabold text-slate-900 text-xs">{period.name}</div>
                      <div className="text-[9px] text-slate-400 mt-0.5 flex items-center justify-center gap-0.5 font-semibold">
                        <Clock className="w-2.5 h-2.5 text-slate-400" />
                        {period.startTime} ~ {period.endTime}
                      </div>
                      {!period.allowed && (
                        <span className="mt-1 inline-block text-[8px] bg-red-50 text-red-600 px-1 rounded font-bold border border-red-100">
                          불가
                        </span>
                      )}
                    </td>

                    {/* 각 특별실 기입 란 */}
                    {settings.specialRooms.map((room) => {
                      const compoundKey = `${room}_${period.id}`;
                      const booking = dailyReservations[compoundKey];

                      if (!period.allowed) {
                        return (
                          <td
                            key={`cell-${room}-${period.id}`}
                            className="p-2 border border-slate-200 bg-slate-100/20 text-center text-[10px] text-slate-400 select-none cursor-not-allowed"
                          >
                            <span className="opacity-40 font-bold">제한</span>
                          </td>
                        );
                      }

                      return (
                        <td
                          key={`cell-${room}-${period.id}`}
                          className="p-1 border border-slate-200 transition-all text-center relative"
                        >
                          {booking ? (
                            // 예약 완료 셀 UI -> 더 고밀도, 단정하게
                            <button
                              onClick={() => openBookingForm(room, period)}
                              className="w-full p-2.5 rounded-lg bg-indigo-50/70 hover:bg-indigo-100/70 border border-indigo-200 text-left transition-all hover:shadow-xs group cursor-pointer"
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="bg-indigo-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded-md truncate max-w-[65px]">
                                  {booking.teacherClass}
                                </span>
                                <span className="text-[10px] text-slate-600 font-bold truncate">
                                  {booking.teacherName}
                                </span>
                              </div>
                              {booking.memo && (
                                <p className="text-[9px] text-slate-500 mt-1 truncate border-l-2 border-indigo-300 pl-1 italic">
                                  {booking.memo}
                                </p>
                              )}
                            </button>
                          ) : (
                            // 예약 가능 빈 셀 UI
                            <button
                              onClick={() => openBookingForm(room, period)}
                              className="w-full py-3 hover:border-indigo-400 rounded-lg hover:bg-indigo-50/40 transition-all text-[10px] text-slate-400 hover:text-indigo-600 flex flex-col items-center justify-center gap-0.5 font-bold group cursor-pointer border border-transparent"
                            >
                              <Plus className="w-3.5 h-3.5 text-slate-300 group-hover:text-indigo-500 transition-colors" />
                              <span>예약 신청</span>
                            </button>
                          )}
                        </td>
                      );
                    })}

                    {/* 통합 요약 칼럼 셀 (Consolidated / Summary Column) */}
                    <td className="p-1.5 border border-slate-200 bg-slate-50/30 text-left align-top w-[220px]">
                      {period.allowed ? (
                        (() => {
                          const summaryList = getCombinedSummary(period.id);
                          if (summaryList.length === 0) {
                            return <span className="text-[9px] text-slate-400 italic block text-center py-2">예약 없음</span>;
                          }
                          return (
                            <div className="space-y-1">
                              {summaryList.map((summary, sIdx) => (
                                <div
                                  key={`summary-${summary.room}-${sIdx}`}
                                  className="text-[10px] bg-white border border-slate-200/85 rounded p-1 flex items-center justify-between gap-1 shadow-2xs"
                                >
                                  <span className="font-bold text-slate-700 truncate w-[70px]">
                                    {summary.room}
                                  </span>
                                  <span className="bg-indigo-50 border border-indigo-100 text-indigo-700 text-[8px] font-bold px-1 rounded flex-shrink-0">
                                    {summary.className} ({summary.teacher})
                                  </span>
                                </div>
                              ))}
                            </div>
                          );
                        })()
                      ) : (
                        <div className="text-[9px] text-rose-400 italic text-center py-2">조정된 일과 없음</div>
                      )}
                    </td>

                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 하단 푸터 표출 영역 */}
          <footer className="mt-auto pt-6 border-t border-slate-100 text-center sm:flex sm:items-center sm:justify-between text-[11px] text-slate-400">
            <p>{settings.copyright}</p>
            <div className="mt-2 sm:mt-0 flex items-center justify-center space-x-2">
              <Mail className="w-3.5 h-3.5 text-slate-300" />
              <span>행정 문의처: <strong>{settings.contactEmail}</strong></span>
            </div>
          </footer>
        </section>
      </main>

      {/* ==========================================
          C. 포커스 아웃 방지형 예약 생성 모달/레이어
          ========================================== */}
      <AnimatePresence>
        {activeBookingCell && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            
            {/* Backdrop 차단막 레이어 */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setActiveBookingCell(null)}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs cursor-pointer"
            />

            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full relative z-10 overflow-hidden"
            >
              {/* 모달 헤더 */}
              <div className="bg-indigo-600 p-4 text-white">
                <div className="flex justify-between items-center">
                  <h3 className="text-md font-extrabold flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-amber-300" />
                    특별실 대여 예약 신청
                  </h3>
                  <button
                    onClick={() => setActiveBookingCell(null)}
                    className="p-1 hover:bg-indigo-700 rounded-lg text-white transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="mt-2 text-xs text-indigo-100 font-medium">
                  {selectedDateStr} | {activeBookingCell.room} | {activeBookingCell.period.name}
                </div>
              </div>

              {/* 예약 폼 본문 */}
              <div className="p-5 space-y-4">
                
                {/* 1. 대상 선택 [HTML 기본 <select> 우회 버그 방지 - React 커스텀 그리드 태핑 UI] */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-extrabold text-slate-700">
                    신청 학급 / 전담 역할 지정
                  </label>
                  <p className="text-[10px] text-slate-400 mb-2">
                    스크롤하여 아래 목록 중 하나를 바로 터치하십시오.
                  </p>
                  
                  <div className="max-h-[140px] overflow-y-auto border border-slate-200 rounded-xl p-2 bg-slate-50 grid grid-cols-2 gap-1.5">
                    {settings.classes.map((className) => {
                      const isActive = formClass === className;
                      return (
                        <button
                          type="button"
                          key={`form-class-opt-${className}`}
                          onClick={() => setFormClass(className)}
                          className={`p-2 rounded-lg text-xs font-bold text-left transition-all ${
                            isActive
                              ? 'bg-indigo-600 text-white shadow-xs'
                              : 'bg-white text-slate-700 border border-slate-200 hover:border-indigo-400'
                          }`}
                        >
                          {className}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 2. 교사명 입력 */}
                <div className="space-y-1">
                  <label className="block text-xs font-extrabold text-slate-700">
                    예약자명 (교사 성함)
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={formTeacher}
                      onChange={(e) => setFormTeacher(e.target.value)}
                      placeholder="교사명을 정확히 기입하여 주십시오"
                      className="w-full p-2.5 text-xs text-slate-800 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
                      required
                    />
                  </div>
                </div>

                {/* 3. 예약 메모 입력 */}
                <div className="space-y-1">
                  <label className="block text-xs font-extrabold text-slate-700">
                    예약 목적 / 사용 단원 (선택 사항)
                  </label>
                  <input
                    type="text"
                    value={formMemo}
                    onChange={(e) => setFormMemo(e.target.value)}
                    placeholder="예: 3단원 현미경 실무, 컴퓨터 정비 실습 등"
                    className="w-full p-2.5 text-xs text-slate-800 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
                  />
                </div>

                {/* 등록 관리 버튼 */}
                <div className="pt-3 border-t border-slate-100 flex space-x-2">
                  <button
                    type="button"
                    onClick={() => setActiveBookingCell(null)}
                    disabled={isSaving}
                    className="flex-1 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-bold rounded-xl transition-all"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={saveReservation}
                    disabled={isSaving}
                    className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-xs font-extrabold rounded-xl transition-all flex items-center justify-center space-x-1.5 shadow-md shadow-indigo-500/10"
                  >
                    {isSaving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                    <span>{isSaving ? "등록 중..." : "예약 예약하기"}</span>
                  </button>
                </div>

              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ==========================================
          D. 기존 예약 상세 열람 및 취소 모달
          ========================================== */}
      <AnimatePresence>
        {showReservationDetail && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowReservationDetail(null)}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs cursor-pointer"
            />

            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-sm w-full relative z-10 overflow-hidden"
            >
              <div className="bg-slate-900 p-4 text-white flex justify-between items-center">
                <div>
                  <span className="text-slate-400 text-[10px] tracking-wider uppercase font-extrabold block">Reservation Standard Card</span>
                  <h3 className="text-sm font-black text-white mt-0.5">예약 인포메이션 상세보기</h3>
                </div>
                <button
                  onClick={() => setShowReservationDetail(null)}
                  className="p-1 hover:bg-slate-800 rounded-lg text-white/80 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                
                {/* 메인 매치 세부 목록 */}
                <div className="bg-slate-50 border border-slate-100 rounded-xl p-3.5 space-y-3">
                  <div>
                    <span className="text-[10px] text-slate-400 font-extrabold uppercase">예약 특별실</span>
                    <p className="text-sm font-black text-slate-900 mt-0.5 flex items-center gap-1">
                      <MapPin className="w-4 h-4 text-indigo-500" />
                      {showReservationDetail.room}
                    </p>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-[10px] text-slate-400 font-extrabold uppercase">예약 일자</span>
                      <p className="text-xs font-bold text-slate-800 mt-0.5">{selectedDateStr}</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 font-extrabold uppercase">예약 타임</span>
                      <p className="text-xs font-bold text-slate-800 mt-0.5">{showReservationDetail.period.name} ({showReservationDetail.period.startTime} ~ {showReservationDetail.period.endTime})</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200/60">
                    <div>
                      <span className="text-[10px] text-slate-400 font-extrabold uppercase">예약 교과/학급</span>
                      <p className="text-xs font-extrabold text-indigo-700 mt-0.5">{showReservationDetail.res.teacherClass}</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 font-extrabold uppercase">예약 교사명</span>
                      <p className="text-xs font-bold text-slate-800 mt-0.5">{showReservationDetail.res.teacherName}</p>
                    </div>
                  </div>

                  {showReservationDetail.res.memo && (
                    <div className="pt-2 border-t border-slate-200/60">
                      <span className="text-[10px] text-slate-400 font-extrabold uppercase">사용 메모</span>
                      <p className="text-xs text-slate-700 mt-0.5 italic text-slate-600 bg-white p-2 rounded-md border border-slate-100">
                        "{showReservationDetail.res.memo}"
                      </p>
                    </div>
                  )}
                </div>

                {/* 예약 폐기 취소 조율 제어자 (익명 포함 누구나 취소 가능, 단 어드민은 마스터 오버라이딩 가능) */}
                <div className="pt-2 flex gap-2">
                  <button
                    onClick={() => setShowReservationDetail(null)}
                    disabled={isSaving}
                    className="flex-1 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-bold rounded-xl transition-all"
                  >
                    메뉴 닫기
                  </button>
                  <button
                    onClick={() => cancelReservation(showReservationDetail.room, showReservationDetail.period.id)}
                    disabled={isSaving}
                    className="py-2.5 px-4 bg-rose-50 border border-slate-100 text-rose-600 hover:bg-rose-100 text-xs font-extrabold rounded-xl transition-all flex items-center justify-center space-x-1.5"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>예약 취소</span>
                  </button>
                </div>

              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ==========================================
          E. 관리자 환경 설정 패널 모달 (Slide-over / Modal Layer)
          ========================================== */}
      <AnimatePresence>
        {isSettingsOpen && (
          <div className="fixed inset-0 z-50 flex justify-end">
            
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setIsSettingsOpen(false);
                setSavingStatus(null);
              }}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs cursor-pointer"
            />

            {/* Slide-over Content Card */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="bg-white w-full max-w-lg h-full shadow-2xl relative z-10 flex flex-col overflow-hidden"
            >
              {/*설정 헤더 */}
              <div className="bg-slate-900 px-5 py-4 text-white flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Sliders className="w-5 h-5 text-indigo-400" />
                  <span className="text-md font-bold tracking-tight">마산중앙초등학교 예약시스템 설정</span>
                </div>
                <button
                  onClick={() => {
                    setIsSettingsOpen(false);
                    setSavingStatus(null);
                  }}
                  className="p-1 hover:bg-slate-800 rounded-lg text-white/80 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* 설정 상세 바디 파트 */}
              <div className="flex-1 overflow-y-auto p-5 space-y-6">
                
                {/* 1단계. 로그인 보안 가드 (Google & Firebase Email System) [미인증 가드 구역] */}
                {!isAdmin ? (
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-center space-y-4">
                    <div className="w-10 h-10 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-600 mx-auto border border-indigo-100">
                      <Lock className="w-4 h-4" />
                    </div>
                    <div className="space-y-1">
                      <h4 className="text-sm font-extrabold text-slate-900">관리자 권한 인증 필요</h4>
                      <p className="text-[11px] text-slate-500 leading-relaxed max-w-sm mx-auto">
                        기본 일과 시간 조절, 신청 학급 목록, 특별실 목록 구성 설정을 변경하기 위해서는 Firebase 인증 로그인이 필요합니다.
                      </p>
                    </div>

                    {/* Firebase 이메일 로그인 / 회원가입 폼 인터페이스 */}
                    <div className="bg-white border border-slate-200 rounded-xl p-4 text-left space-y-3.5 shadow-xs">
                      <div className="flex border-b border-slate-150 pb-2">
                        <button
                          type="button"
                          onClick={() => {
                            setIsRegisterMode(false);
                            setAuthErrorMsg(null);
                          }}
                          className={`flex-1 text-center pb-1.5 text-xs font-black transition-colors ${!isRegisterMode ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                          이메일 로그인
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setIsRegisterMode(true);
                            setAuthErrorMsg(null);
                          }}
                          className={`flex-1 text-center pb-1.5 text-xs font-black transition-colors ${isRegisterMode ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                          교사 회원가입
                        </button>
                      </div>

                      <form onSubmit={isRegisterMode ? handleEmailRegister : handleEmailLogin} className="space-y-3">
                        {isRegisterMode && (
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-slate-500 uppercase">선생님 성함</label>
                            <input
                              type="text"
                              value={inputDisplayName}
                              onChange={(e) => setInputDisplayName(e.target.value)}
                              placeholder="홍길동"
                              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-semibold focus:ring-1 focus:ring-indigo-500 outline-hidden bg-slate-50/30"
                              required
                            />
                          </div>
                        )}

                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-500 uppercase">학교 이메일 주소</label>
                          <input
                            type="email"
                            value={inputEmail}
                            onChange={(e) => setInputEmail(e.target.value)}
                            placeholder="teacher@school.es.kr"
                            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-semibold focus:ring-1 focus:ring-indigo-500 outline-hidden bg-slate-50/30"
                            required
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-500 uppercase">비밀번호</label>
                          <input
                            type="password"
                            value={inputPassword}
                            onChange={(e) => setInputPassword(e.target.value)}
                            placeholder="6자리 이상"
                            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-semibold focus:ring-1 focus:ring-indigo-500 outline-hidden bg-slate-50/30"
                            required
                          />
                        </div>

                        {authErrorMsg && (
                          <div className="p-2.5 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600 flex items-center gap-1.5 font-bold">
                            <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                            <span>{authErrorMsg}</span>
                          </div>
                        )}

                        <button
                          type="submit"
                          className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black rounded-lg transition-colors shadow-sm cursor-pointer"
                        >
                          {isRegisterMode ? "선생님 회원가입 신청" : "Firebase 보안 인증 로그인"}
                        </button>
                      </form>

                      {!isRegisterMode && (
                        <p className="text-[9px] text-slate-400 text-center leading-normal">
                          첫 방문이시라면 우측 탭 <span className="font-bold text-indigo-600 cursor-pointer hover:underline" onClick={() => setIsRegisterMode(true)}>교사 회원가입</span>을 진행해 주세요.
                        </p>
                      )}
                    </div>

                    <div className="flex items-center my-2 text-slate-300">
                      <div className="flex-1 border-t border-slate-200" />
                      <span className="px-2 text-[10px] font-bold text-slate-400">또는</span>
                      <div className="flex-1 border-t border-slate-200" />
                    </div>

                    {/* 로그인 에러 알람 (일반 구글 아이디로 로그인했으나 권한이 없을 때 경고) */}
                    {currentUser && !currentUser.isAnonymous && !isAdmin && (
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-left space-y-1">
                        <div className="flex items-center space-x-1.5 text-amber-800 font-bold text-xs">
                          <AlertCircle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
                          <span>접근 권한이 제한된 계정입니다.</span>
                        </div>
                        <p className="text-[10px] text-amber-700 leading-snug">
                          구글 '{currentUser.email}' 계정은 사전 지정된 관리자 UID가 아닙니다. 
                          관리자 가입을 원하시면 위의 <b>교사 회원가입</b> 기능을 이용해 주세요.
                        </p>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <button
                        type="button"
                        onClick={handleGoogleLogin}
                        className="w-full py-2 bg-white border border-slate-200/80 hover:border-indigo-400 text-slate-700 text-xs font-bold rounded-lg transition-all flex items-center justify-center space-x-2 shadow-xs cursor-pointer"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                          <path fill="#EA4335" d="M12.24 10.285V14.4h6.887c-.648 2.41-2.519 4.114-5.136 4.114A5.514 5.514 0 0 1 8.5 13c0-3.046 2.468-5.514 5.491-5.514 1.353 0 2.59.49 3.555 1.29l2.955-2.955C18.663 4.114 16.275 3 13.99 3c-5.522 0-9.99 4.477-9.99 10 0 5.522 4.468 10 9.99 10 5.137 0 9.428-3.414 9.918-8.286h-11.66z"/>
                        </svg>
                        <span>Google 간편인증</span>
                      </button>
                      <p className="text-[9px] text-slate-400 leading-normal max-w-xs mx-auto">
                        관리자 가입 이메일에 "admin" 단어가 들어가거나 user 이메일인 <b>netsci10@gmail.com</b>으로 가입/로그인하시면 즉시 최고관리자 자격이 활성화됩니다.
                      </p>
                    </div>
                  </div>
                ) : (
                  
                  // [관리자 전용 설정 구획]
                  <div className="space-y-6">
                    
                    {/* 어드민 인증 성공 배너 */}
                    <div className="bg-indigo-600 rounded-xl p-4 text-white flex items-center justify-between">
                      <div className="flex items-center space-x-2.5">
                        <span className="p-1.5 bg-indigo-500 rounded-lg">
                          <Check className="w-4 h-4 text-white" />
                        </span>
                        <div>
                          <p className="text-xs font-bold text-indigo-100">성공적으로 인증됨</p>
                          <p className="text-md font-black">{currentUser?.email || '익명 통합 관리 어드민'}</p>
                        </div>
                      </div>
                      <button
                        onClick={handleSignOut}
                        className="text-[10px] font-bold bg-indigo-800 hover:bg-rose-600 px-2.5 py-1.5 rounded-lg border border-indigo-700 transition-all text-white flex items-center gap-1"
                      >
                        <LogOut className="w-3 h-3" />
                        로그아웃
                      </button>
                    </div>

                    {/* 어드민 네비게이션 탭 */}
                    <div className="border-b border-slate-200/80 flex space-x-2">
                      {[
                        { id: 'info', label: '기본 정보', icon: Sliders },
                        { id: 'rooms', label: '특별실 설정', icon: MapPin },
                        { id: 'classes', label: '신청학급', icon: BookOpen },
                        { id: 'periods', label: '기본일과', icon: Clock }
                      ].map((tab) => {
                        const Icon = tab.icon;
                        const isTabActive = adminSectionTab === tab.id;
                        return (
                          <button
                            key={tab.id}
                            onClick={() => setAdminSectionTab(tab.id as any)}
                            className={`flex-1 pb-3 text-center text-xs font-bold transition-all border-b-2 flex flex-col items-center gap-1 ${
                              isTabActive
                                ? 'border-indigo-600 text-indigo-600'
                                : 'border-transparent text-slate-400 hover:text-slate-600'
                            }`}
                          >
                            <Icon className="w-4 h-4" />
                            {tab.label}
                          </button>
                        );
                      })}
                    </div>

                    {/* 탭 본문 1. 기본 정보 설정 */}
                    {adminSectionTab === 'info' && (
                      <div className="space-y-4 animate-fadeIn">
                        <div className="space-y-1">
                          <label className="block text-xs font-bold text-slate-700">애플리케이션 타이틀</label>
                          <input
                            type="text"
                            value={editGeneral.appName}
                            onChange={(e) => setEditGeneral({ ...editGeneral, appName: e.target.value })}
                            className="w-full p-2.5 text-xs text-slate-800 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 bg-white"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="block text-xs font-bold text-slate-700">앱 세부 설명 구문</label>
                          <textarea
                            rows={3}
                            value={editGeneral.appDescription}
                            onChange={(e) => setEditGeneral({ ...editGeneral, appDescription: e.target.value })}
                            className="w-full p-2.5 text-xs text-slate-800 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 bg-white"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="block text-xs font-bold text-slate-700">하단 저작권 (Copyright)</label>
                          <input
                            type="text"
                            value={editGeneral.copyright}
                            onChange={(e) => setEditGeneral({ ...editGeneral, copyright: e.target.value })}
                            className="w-full p-2.5 text-xs text-slate-800 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 bg-white"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="block text-xs font-bold text-slate-700">문의 담당 이메일</label>
                          <input
                            type="email"
                            value={editGeneral.contactEmail}
                            onChange={(e) => setEditGeneral({ ...editGeneral, contactEmail: e.target.value })}
                            className="w-full p-2.5 text-xs text-slate-800 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 bg-white"
                          />
                        </div>

                        {savingStatus && (
                          <p className="text-xs text-indigo-600 font-bold text-center mt-2 animate-bounce">
                            {savingStatus}
                          </p>
                        )}

                        <button
                          type="button"
                          onClick={saveGeneralSettings}
                          disabled={isSaving}
                          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-xs font-extrabold rounded-xl transition-all shadow-md shadow-indigo-500/10 flex items-center justify-center space-x-1.5"
                        >
                          {isSaving && <RefreshCw className="w-4 h-4 animate-spin" />}
                          <span>일반 및 기본 정보 실시간 저장</span>
                        </button>
                      </div>
                    )}

                    {/* 탭 본문 2. 특별실 추가 및 제거 */}
                    {adminSectionTab === 'rooms' && (
                      <div className="space-y-4 animate-fadeIn">
                        
                        {/* 특별실 등록 폼 */}
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={newRoomInput}
                            onChange={(e) => setNewRoomInput(e.target.value)}
                            placeholder="추가할 특별실 이름 (예: AI융합실)"
                            className="flex-1 p-2.5 text-xs text-slate-800 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 bg-white"
                          />
                          <button
                            type="button"
                            onClick={addSpecialRoom}
                            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-all"
                          >
                            추가
                          </button>
                        </div>

                        {/* 특별실 목록 리스트 */}
                        <div className="space-y-2">
                          <label className="block text-xs font-extrabold text-slate-700">현재 등록된 특별실 목록</label>
                          <p className="text-[10px] text-slate-400">삭제 시, 메인예약 보드 칼럼에도 실시간 업데이트됩니다.</p>
                          
                          <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
                            {settings.specialRooms.map((room) => (
                              <div key={`room-list-${room}`} className="p-3 bg-white flex items-center justify-between text-xs">
                                <span className="font-bold text-slate-800">{room}</span>
                                <button
                                  type="button"
                                  onClick={() => removeSpecialRoom(room)}
                                  className="p-1 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg transition-all"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>

                      </div>
                    )}

                    {/* 탭 본문 3. 예약 학급 관리 */}
                    {adminSectionTab === 'classes' && (
                      <div className="space-y-4 animate-fadeIn">
                        
                        {/* 예약 대상 학급 등록 폼 */}
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={newClassInput}
                            onChange={(e) => setNewClassInput(e.target.value)}
                            placeholder="예: 2학년 과학, 돌봄3반 등"
                            className="flex-1 p-2.5 text-xs text-slate-800 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 bg-white"
                          />
                          <button
                            type="button"
                            onClick={addClassItem}
                            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-all"
                          >
                            추가
                          </button>
                        </div>

                        {/* 대상 목록 리스트 */}
                        <div className="space-y-2">
                          <label className="block text-xs font-extrabold text-slate-700">등록된 학급/교사 리스트</label>
                          
                          <div className="border border-slate-200 rounded-xl bg-slate-50 p-2 max-h-[250px] overflow-y-auto grid grid-cols-2 gap-2">
                            {settings.classes.map((className) => (
                              <div
                                key={`class-list-${className}`}
                                className="p-2 bg-white border border-slate-100 rounded-lg flex items-center justify-between text-xs shadow-2xs"
                              >
                                <span className="font-semibold text-slate-700 truncate w-[100px]">
                                  {className}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => removeClassItem(className)}
                                  className="p-1 hover:bg-rose-50 text-slate-400 hover:text-rose-650 rounded-lg transition-all flex-shrink-0"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>

                      </div>
                    )}

                    {/* 탭 본문 4. 기본 일과 관리 */}
                    {adminSectionTab === 'periods' && (
                      <div className="space-y-4 animate-fadeIn">
                        <label className="block text-xs font-extrabold text-slate-700">학업 교시 정보와 시작/종료 시간 변경</label>
                        <p className="text-[10px] text-slate-400">교시명 혹은 시간을 클릭 변경하시고, 예약 가능 여부를 체크박스로 변경하십시오.</p>

                        <div className="space-y-3">
                          {settings.periods.map((period) => (
                            <div
                              key={`period-manage-${period.id}`}
                              className="p-3 border border-slate-200/80 rounded-xl bg-slate-50 space-y-2.5"
                            >
                              <div className="flex items-center justify-between">
                                <input
                                  type="text"
                                  value={period.name}
                                  onChange={(e) => modifyPeriodTime(period.id, 'name', e.target.value)}
                                  className="w-[80px] p-1 text-xs font-bold text-slate-800 bg-white border border-slate-200 rounded-md"
                                />

                                <label className="flex items-center space-x-1.5 cursor-pointer text-xs font-bold text-slate-700 select-none">
                                  <input
                                    type="checkbox"
                                    checked={period.allowed}
                                    onChange={() => togglePeriodAllowed(period.id, period.allowed)}
                                    className="w-4 h-4 text-indigo-600 border-slate-300 rounded-sm focus:ring-indigo-500"
                                  />
                                  <span>예약 허용</span>
                                </label>
                              </div>

                              <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                  <span className="block text-[9px] text-slate-400 font-extrabold uppercase">시작 시간</span>
                                  <input
                                    type="text"
                                    value={period.startTime}
                                    onChange={(e) => modifyPeriodTime(period.id, 'startTime', e.target.value)}
                                    placeholder="09:00"
                                    className="w-full p-1.5 text-xs text-center border border-slate-200 rounded-lg bg-white"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <span className="block text-[9px] text-slate-400 font-extrabold uppercase">종료 시간</span>
                                  <input
                                    type="text"
                                    value={period.endTime}
                                    onChange={(e) => modifyPeriodTime(period.id, 'endTime', e.target.value)}
                                    placeholder="09:40"
                                    className="w-full p-1.5 text-xs text-center border border-slate-200 rounded-lg bg-white"
                                  />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  </div>
                )}

              </div>

              {/* 설정 푸터 */}
              <div className="bg-slate-50 px-5 py-4 border-t border-slate-200 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsSettingsOpen(false);
                    setSavingStatus(null);
                  }}
                  className="px-4 py-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-white font-extrabold text-xs rounded-xl transition-all shadow-xs"
                >
                  설정창 닫기
                </button>
              </div>

            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
    </div>
  );
}
