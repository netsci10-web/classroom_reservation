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
  BookOpen,
  Edit2,
  ArrowLeft
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
  roomsPerRow?: number;
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
  ],
  roomsPerRow: 3
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

  // 메인 예약 현황 보드에서 현재 선택된 특별실 (null 일 때 전체 리스트 카드 표출)
  const [selectedBoardRoom, setSelectedBoardRoom] = useState<string | null>(null);

  // 예약 신청 모달 내부 유효성 검사 및 에러 노출용 상태
  const [formValidationError, setFormValidationError] = useState<string | null>(null);
  // 예외/알림 전체를 비차단(Non-blocking) 토스트 형태로 띄울 상태
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'error' | 'success' } | null>(null);
  // 커스텀 리액트 기반 삭제 검증 모달 상태
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<{ room: string; periodId: number; res?: Reservation } | null>(null);

  // 설정 편집용 로컬 상태
  const [editGeneral, setEditGeneral] = useState({
    appName: '',
    appDescription: '',
    copyright: '',
    contactEmail: '',
    roomsPerRow: 3 as number
  });
  const [newRoomInput, setNewRoomInput] = useState<string>('');
  const [editingRoom, setEditingRoom] = useState<string | null>(null);
  const [editingRoomNameInput, setEditingRoomNameInput] = useState<string>('');
  const [newClassInput, setNewClassInput] = useState<string>('');
  const [editingClass, setEditingClass] = useState<string | null>(null);
  const [editingClassNameInput, setEditingClassNameInput] = useState<string>('');

  // 기본 일과 편집용 로컬 상태
  const [newPeriodName, setNewPeriodName] = useState<string>('');
  const [newPeriodStartTime, setNewPeriodStartTime] = useState<string>('09:00');
  const [newPeriodEndTime, setNewPeriodEndTime] = useState<string>('09:40');

  // 기존 일과 온라인/인라인 편집 제어용 상태
  const [editingPeriodId, setEditingPeriodId] = useState<number | null>(null);
  const [editingPeriodNameInput, setEditingPeriodNameInput] = useState<string>('');
  const [editingPeriodStartTimeInput, setEditingPeriodStartTimeInput] = useState<string>('');
  const [editingPeriodEndTimeInput, setEditingPeriodEndTimeInput] = useState<string>('');

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
    const settingsRef = doc(db, 'school_settings', 'config');
    setSettingsLoading(true);

    const unsub = onSnapshot(settingsRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data() as AppSettings;
        const incomingPeriods = data.periods || defaultSettings.periods;
        const sortedPeriods = [...incomingPeriods].sort((a, b) => a.startTime.localeCompare(b.startTime));
        
        setSettings({
          appName: data.appName || defaultSettings.appName,
          appDescription: data.appDescription || defaultSettings.appDescription,
          copyright: data.copyright || defaultSettings.copyright,
          contactEmail: data.contactEmail || defaultSettings.contactEmail,
          specialRooms: data.specialRooms || defaultSettings.specialRooms,
          classes: data.classes || defaultSettings.classes,
          periods: sortedPeriods,
          roomsPerRow: data.roomsPerRow || defaultSettings.roomsPerRow || 3
        });

        setEditGeneral({
          appName: data.appName || defaultSettings.appName,
          appDescription: data.appDescription || defaultSettings.appDescription,
          copyright: data.copyright || defaultSettings.copyright,
          contactEmail: data.contactEmail || defaultSettings.contactEmail,
          roomsPerRow: data.roomsPerRow || defaultSettings.roomsPerRow || 3
        });
      } else {
        // 아직 Firestore 데이터가 없을 때 로컬 기본값 적용 후, 관리자 로그인을 통한 데이터 저장을 지원
        setSettings(defaultSettings);
        setEditGeneral({
          appName: defaultSettings.appName,
          appDescription: defaultSettings.appDescription,
          copyright: defaultSettings.copyright,
          contactEmail: defaultSettings.contactEmail,
          roomsPerRow: defaultSettings.roomsPerRow || 3
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
    const reservationsRef = doc(db, 'school_reservations', selectedDateStr);

    const unsub = onSnapshot(reservationsRef, (docSnap) => {
      if (docSnap.exists()) {
        setDailyReservations(docSnap.data().reservations || {});
      } else {
        setDailyReservations({});
      }
      setDailyLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `school_reservations/${selectedDateStr}`);
      setDailyLoading(false);
    });

    return () => unsub();
  }, [selectedDateStr, appId]);

  // 5. Real-time Monthly Reservation Status (가벼운 전수 달력 도트 마킹용)
  useEffect(() => {
    const resColl = collection(db, 'school_reservations');
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
  const showToast = (text: string, type: 'error' | 'success' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  };

  const openBookingForm = (room: string, period: Period) => {
    const compoundKey = `${room}_${period.id}`;
    const existing = dailyReservations[compoundKey];

    setFormValidationError(null);

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
    setFormValidationError(null);
    if (!formTeacher.trim()) {
      setFormValidationError("예약하시는 분(교사 성함)을 정확히 기입해 주세요.");
      return;
    }

    setIsSaving(true);
    const compoundKey = `${activeBookingCell.room}_${activeBookingCell.period.id}`;
    const existingRes = dailyReservations[compoundKey];
    const isEdit = !!existingRes;
    
    const newReservation: Reservation = {
      teacherClass: formClass,
      teacherName: formTeacher.trim(),
      memo: formMemo.trim(),
      reservedByUid: existingRes?.reservedByUid || currentUser?.uid || 'anonymous',
      reservedByName: existingRes?.reservedByName || currentUser?.displayName || '익명교사',
      createdAt: existingRes?.createdAt || new Date().toISOString()
    };

    const updatedReservations = {
      ...dailyReservations,
      [compoundKey]: newReservation
    };

    const resPath = `school_reservations/${selectedDateStr}`;
    try {
      const resDocRef = doc(db, 'school_reservations', selectedDateStr);
      await setDoc(resDocRef, { reservations: updatedReservations }, { merge: true });
      setActiveBookingCell(null);
      showToast(isEdit ? "예약이 성공적으로 수정되었습니다." : "예약이 정상적으로 등록되었습니다!", "success");
    } catch (error: any) {
      console.error("예약 저장 에러:", error);
      setFormValidationError("예약 저장에 실패했습니다. (서버 보안 규칙 또는 일시적인 권한 문제)");
      handleFirestoreError(error, OperationType.WRITE, resPath);
    } finally {
      setIsSaving(false);
    }
  };

  const executeCancelReservation = async (room: string, periodId: number) => {
    setIsSaving(true);
    const compoundKey = `${room}_${periodId}`;
    
    const updated = { ...dailyReservations };
    delete updated[compoundKey];

    const resPath = `school_reservations/${selectedDateStr}`;
    try {
      const resDocRef = doc(db, 'school_reservations', selectedDateStr);
      await setDoc(resDocRef, { reservations: updated });
      setShowReservationDetail(null);
      setDeleteConfirmTarget(null);
      showToast("예약 자리가 정상적으로 취소(반납)되었습니다.", "success");
    } catch (error: any) {
      console.error("예약 취소 에러:", error);
      showToast("예약을 취소하지 못했습니다. (권한 없음 혹은 네트워크 오류)", "error");
      handleFirestoreError(error, OperationType.DELETE, resPath);
    } finally {
      setIsSaving(false);
    }
  };

  const cancelReservation = async (room: string, periodId: number) => {
    const compoundKey = `${room}_${periodId}`;
    const res = dailyReservations[compoundKey];
    setDeleteConfirmTarget({ room, periodId, res });
  };

  const startEditingReservation = () => {
    if (!showReservationDetail) return;
    const { room, period, res } = showReservationDetail;
    setFormClass(res.teacherClass);
    setFormTeacher(res.teacherName);
    setFormMemo(res.memo || '');
    setActiveBookingCell({ room, period });
    setShowReservationDetail(null);
    setFormValidationError(null);
  };

  // ------------------------------------------
  // 관리자 설정 변경 액션 (Admin Settings Logic)
  // ------------------------------------------
  const saveGeneralSettings = async () => {
    if (!isAdmin) {
      alert("관리자 권한이 없습니다.");
      return;
    }
    setIsSaving(true);
    setSavingStatus("저장 중...");
    
    const settingsPath = 'school_settings/config';
    try {
      const settingsRef = doc(db, 'school_settings', 'config');
      await setDoc(settingsRef, {
        ...settings,
        appName: editGeneral.appName,
        appDescription: editGeneral.appDescription,
        copyright: editGeneral.copyright,
        contactEmail: editGeneral.contactEmail,
        roomsPerRow: editGeneral.roomsPerRow || 3
      }, { merge: true });
      
      setSavingStatus("성공적으로 저장되었습니다!");
      setTimeout(() => setSavingStatus(null), 3000);
    } catch (error: any) {
      console.error("설정 저장 에러:", error);
      setSavingStatus("저장 실패 (권한 없음)");
      alert(`설정 저장에 실패했습니다.\n(Firebase 권한 규칙에 어긋나거나 관리자 계정 권한이 적용되지 않았을 수 있습니다.)`);
      setTimeout(() => setSavingStatus(null), 3500);
    } finally {
      setIsSaving(false);
    }
  };

  const addSpecialRoom = async () => {
    if (!isAdmin) return;
    if (!newRoomInput.trim()) return;
    if (settings.specialRooms.includes(newRoomInput.trim())) {
      alert("이미 존재하는 특별실 이름입니다.");
      return;
    }

    setIsSaving(true);
    const newList = [...settings.specialRooms, newRoomInput.trim()];
    try {
      const settingsRef = doc(db, 'school_settings', 'config');
      await setDoc(settingsRef, { specialRooms: newList }, { merge: true });
      setNewRoomInput('');
    } catch (error: any) {
      console.error("특별실 추가 에러:", error);
      alert("특별실 추가 권한이 없습니다.");
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
      const settingsRef = doc(db, 'school_settings', 'config');
      await setDoc(settingsRef, { specialRooms: newList }, { merge: true });
    } catch (error: any) {
      console.error("특별실 삭제 에러:", error);
      alert("특별실 삭제 권한이 없습니다.");
    } finally {
      setIsSaving(false);
    }
  };

  const saveEditedRoomName = async (oldName: string) => {
    if (!isAdmin) return;
    const newName = editingRoomNameInput.trim();
    if (!newName) {
      alert("특별실 이름을 입력해 주세요.");
      return;
    }
    if (newName === oldName) {
      setEditingRoom(null);
      return;
    }
    if (settings.specialRooms.includes(newName)) {
      alert("이미 존재하는 특별실 이름입니다.");
      return;
    }

    setIsSaving(true);
    const newList = settings.specialRooms.map(r => r === oldName ? newName : r);
    try {
      const settingsRef = doc(db, 'school_settings', 'config');
      await setDoc(settingsRef, { specialRooms: newList }, { merge: true });
      setEditingRoom(null);
    } catch (error: any) {
      console.error("특별실 이름 수정 에러:", error);
      alert("특별실 이름 수정 권한이 없습니다.");
    } finally {
      setIsSaving(false);
    }
  };

  const addClassItem = async () => {
    if (!isAdmin) return;
    if (!newClassInput.trim()) return;
    if (settings.classes.includes(newClassInput.trim())) {
      alert("이미 존재하는 대상(학급)입니다.");
      return;
    }

    setIsSaving(true);
    const newList = [...settings.classes, newClassInput.trim()];
    try {
      const settingsRef = doc(db, 'school_settings', 'config');
      await setDoc(settingsRef, { classes: newList }, { merge: true });
      setNewClassInput('');
    } catch (error: any) {
      console.error("학급 추가 에러:", error);
      alert("학급 추가 권한이 없습니다.");
    } finally {
      setIsSaving(false);
    }
  };

  const removeClassItem = async (className: string) => {
    if (!isAdmin) return;
    setIsSaving(true);
    const newList = settings.classes.filter(c => c !== className);
    try {
      const settingsRef = doc(db, 'school_settings', 'config');
      await setDoc(settingsRef, { classes: newList }, { merge: true });
    } catch (error: any) {
      console.error("학급 삭제 에러:", error);
      alert("학급 삭제 권한이 없습니다.");
    } finally {
      setIsSaving(false);
    }
  };

  const saveEditedClassName = async (oldName: string) => {
    if (!isAdmin) return;
    const newName = editingClassNameInput.trim();
    if (!newName) {
      alert("학급/교사 이름을 입력해 주세요.");
      return;
    }
    if (newName === oldName) {
      setEditingClass(null);
      return;
    }
    if (settings.classes.includes(newName)) {
      alert("이미 존재하는 학급/교사 이름입니다.");
      return;
    }

    setIsSaving(true);
    const newList = settings.classes.map(c => c === oldName ? newName : c);
    try {
      const settingsRef = doc(db, 'school_settings', 'config');
      await setDoc(settingsRef, { classes: newList }, { merge: true });
      setEditingClass(null);
    } catch (error: any) {
      console.error("학급 이름 수정 에러:", error);
      alert("학급 이름 수정 권한이 없습니다.");
    } finally {
      setIsSaving(false);
    }
  };

  const addPeriodItem = async () => {
    if (!isAdmin) return;
    const nameStr = newPeriodName.trim();
    if (!nameStr) {
      alert("교시 이름을 입력해 주세요.");
      return;
    }
    
    // Check if period name already exists
    if (settings.periods.some(p => p.name === nameStr)) {
      alert("이미 존재하는 교시 이름입니다.");
      return;
    }

    setIsSaving(true);
    const nextId = settings.periods.length > 0 ? Math.max(...settings.periods.map(p => p.id), 0) + 1 : 1;
    const newPeriod: Period = {
      id: nextId,
      name: nameStr,
      startTime: newPeriodStartTime.trim() || '09:00',
      endTime: newPeriodEndTime.trim() || '09:40',
      allowed: true
    };

    const newPeriods = [...settings.periods, newPeriod];
    try {
      const settingsRef = doc(db, 'school_settings', 'config');
      await setDoc(settingsRef, { periods: newPeriods }, { merge: true });
      setNewPeriodName('');
      setNewPeriodStartTime('09:00');
      setNewPeriodEndTime('09:40');
    } catch (error: any) {
      console.error("교시 추가 에러:", error);
      alert("교시 추가 권한이 없습니다.");
    } finally {
      setIsSaving(false);
    }
  };

  const removePeriodItem = async (periodId: number) => {
    if (!isAdmin) return;
    if (!confirm("이 교시를 정말 삭제하시겠습니까?\n삭제 시 이 교시의 예약 내용들도 보이지 않게 될 수 있습니다.")) return;
    setIsSaving(true);
    const newPeriods = settings.periods.filter(p => p.id !== periodId);
    try {
      const settingsRef = doc(db, 'school_settings', 'config');
      await setDoc(settingsRef, { periods: newPeriods }, { merge: true });
    } catch (error: any) {
      console.error("교시 삭제 에러:", error);
      alert("교시 삭제 권한이 없습니다.");
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
      const settingsRef = doc(db, 'school_settings', 'config');
      await setDoc(settingsRef, { periods: newPeriods }, { merge: true });
    } catch (error: any) {
      console.error("교시 활성화 변경 에러:", error);
      alert("교시 설정 수정 권한이 없습니다.");
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
      const settingsRef = doc(db, 'school_settings', 'config');
      await setDoc(settingsRef, { periods: newPeriods }, { merge: true });
    } catch (error: any) {
      console.error("교시 시간 편집 에러:", error);
      alert("시간 편집 수정 권한이 없습니다.");
    }
  };

  const saveEditedPeriod = async (periodId: number) => {
    if (!isAdmin) return;
    const nameStr = editingPeriodNameInput.trim();
    if (!nameStr) {
      alert("일과(교시) 이름을 입력해 주세요.");
      return;
    }

    if (settings.periods.some(p => p.id !== periodId && p.name === nameStr)) {
      alert("이미 동일한 일과(교시)명이 존재합니다.");
      return;
    }

    setIsSaving(true);
    const newPeriods = settings.periods.map(p => {
      if (p.id === periodId) {
        return {
          ...p,
          name: nameStr,
          startTime: editingPeriodStartTimeInput.trim() || p.startTime,
          endTime: editingPeriodEndTimeInput.trim() || p.endTime
        };
      }
      return p;
    });

    try {
      const settingsRef = doc(db, 'school_settings', 'config');
      await setDoc(settingsRef, { periods: newPeriods }, { merge: true });
      setEditingPeriodId(null);
    } catch (error: any) {
      console.error("일과 수정 에러:", error);
      alert("일과 정보 수정 권한이 없습니다.");
    } finally {
      setIsSaving(false);
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
      cells.push(<div key={`empty-${i}`} className="h-7 flex items-center justify-center text-[10px] text-slate-200" />);
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
          className={`h-7 w-full flex flex-col items-center justify-center text-[11px] font-semibold border relative rounded-md transition-all cursor-pointer ${
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
            <span className={`absolute bottom-0.5 w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-amber-300' : 'bg-indigo-500'}`} />
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
        <div 
          onClick={() => {
            setSelectedBoardRoom(null);
            setActiveBookingCell(null);
            setShowReservationDetail(null);
            setIsSettingsOpen(false);
          }}
          className="flex items-center gap-3 cursor-pointer group hover:opacity-95 select-none"
          title="초기화면으로 이동"
        >
          <div className="w-9 h-9 bg-indigo-600 rounded-lg flex items-center justify-center text-white shadow-sm flex-shrink-0 group-hover:scale-105 transition-transform">
            <BookOpen className="h-4.5 w-4.5" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-900 leading-tight flex items-center gap-1.5 group-hover:text-indigo-650 transition-colors">
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
      <main className="flex-1 flex p-4 gap-4 flex-col md:flex-row overflow-y-auto md:overflow-hidden min-h-0">
        
        {/* Sidebar: Calendar & Today's Summary */}
        <aside className="w-full md:w-[280px] flex flex-col gap-4 flex-shrink-0 overflow-y-auto md:overflow-visible">
          
          {/* Calendar Card */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-3">
            <div className="flex items-center justify-between mb-2.5">
              <h2 className="font-bold text-slate-800 text-xs">{calendarMonth.getFullYear()}년 {calendarMonth.getMonth() + 1}월</h2>
              <div className="flex gap-1">
                <button 
                  onClick={prevMonth} 
                  className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button 
                  onClick={setToday} 
                  className="px-1.5 py-0.5 text-[9px] font-bold text-indigo-600 hover:bg-indigo-50 rounded transition-colors whitespace-nowrap"
                >
                  오늘
                </button>
                <button 
                  onClick={nextMonth} 
                  className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded transition-colors"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            
            <div className="grid grid-cols-7 text-center text-[9px] font-bold text-slate-400 uppercase mb-1.5">
              <div className="text-red-500">일</div>
              <div>월</div>
              <div>화</div>
              <div>수</div>
              <div>목</div>
              <div>금</div>
              <div className="text-blue-500">토</div>
            </div>
            
            <div className="grid grid-cols-7 gap-0.5">
              {renderCalendarDays()}
            </div>
          </div>

          {/* Today's Summary (오늘의 요약) Card */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-3 flex-1 flex flex-col overflow-hidden min-h-[300px]">
            <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider mb-2 flex items-center gap-1.5 border-b border-slate-100 pb-1.5">
              <span className="w-1.5 h-3 bg-indigo-600 rounded-sm"></span>
              날짜별 예약 요약 ({selectedDate.getMonth() + 1}월 {selectedDate.getDate()}일)
            </h3>
            
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {/* 특별실별 요약 비율 */}
              <div className="space-y-1.5">
                <span className="block text-[10px] font-extrabold text-slate-400 tracking-wider">특별실별 예약 현황</span>
                <div className="grid grid-cols-2 gap-1.5">
                  {settings.specialRooms.map((room, roomIdx) => {
                    const totalPeriods = settings.periods.filter(p => p.allowed).length;
                    const bookedCount = settings.periods.filter(p => {
                      if (!p.allowed) return false;
                      const key = `${room}_${p.id}`;
                      return !!dailyReservations[key];
                    }).length;

                    const themes = [
                      { bg: 'bg-indigo-50/80 border border-indigo-100 text-indigo-700', sub: 'bg-indigo-200/55', text: 'text-indigo-700' },
                      { bg: 'bg-emerald-50/80 border border-emerald-100 text-emerald-700', sub: 'bg-emerald-200/55', text: 'text-emerald-700' },
                      { bg: 'bg-amber-50/80 border border-amber-100 text-amber-700', sub: 'bg-amber-200/55', text: 'text-amber-700' },
                      { bg: 'bg-sky-50/80 border border-sky-100 text-sky-700', sub: 'bg-sky-200/55', text: 'text-sky-700' },
                      { bg: 'bg-rose-50/80 border border-rose-100 text-rose-700', sub: 'bg-rose-200/55', text: 'text-rose-700' }
                    ];
                    const activeTheme = themes[roomIdx % themes.length];
                    const percent = totalPeriods > 0 ? (bookedCount / totalPeriods) * 100 : 0;

                    return (
                      <div key={`summary-${roomIdx}`} className={`p-1.5 rounded-lg border transition-all ${activeTheme.bg} flex flex-col gap-1`}>
                        <div className="flex justify-between items-center text-[10px] leading-tight-none">
                          <span className="font-bold truncate max-w-[65px]" title={room}>{room}</span>
                          <span className={`font-black text-[9px] ${activeTheme.text}`}>
                            {bookedCount}/{totalPeriods}
                          </span>
                        </div>
                        {/* 미니 프로그레스 바 */}
                        <div className="w-full h-1 bg-slate-200/60 rounded-full overflow-hidden">
                          <div className={`h-full ${activeTheme.sub} rounded-full transition-all duration-300`} style={{ width: `${percent}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 실시간 상세 예약 목록 */}
              <div className="border-t border-slate-100 pt-3">
                {(() => {
                  const todayBookingsList: { room: string; p: any; booking: any }[] = [];
                  settings.specialRooms.forEach(room => {
                    settings.periods.forEach(p => {
                      const key = `${room}_${p.id}`;
                      const booking = dailyReservations[key];
                      if (booking) {
                        todayBookingsList.push({ room, p, booking });
                      }
                    });
                  });

                  return (
                    <div className="space-y-2">
                      <span className="block text-[10px] font-extrabold text-slate-400 tracking-wider">
                        실시간 상세 예약 ({todayBookingsList.length})
                      </span>
                      {todayBookingsList.length === 0 ? (
                        <div className="p-4 bg-slate-50 border border-slate-150 rounded-xl text-center">
                          <p className="text-[11px] text-slate-400 font-medium">선택한 날짜에 등록된<br />예약 일정이 없습니다.</p>
                        </div>
                      ) : (
                        <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-0.5">
                          {todayBookingsList.map((item, idx) => (
                            <div key={`side-res-${idx}`} className="p-2.5 bg-slate-50 border border-slate-150 rounded-lg text-[11px] flex flex-col gap-1 hover:border-slate-300 transition-colors">
                              <div className="flex items-center justify-between font-bold">
                                <span className="text-slate-800">{item.room} <span className="text-slate-400">·</span> {item.p.name}</span>
                                <span className="text-indigo-700 bg-indigo-50 border border-indigo-100 px-1.5 py-0.2 rounded text-[9px] font-black">
                                  {item.booking.teacherClass}
                                </span>
                              </div>
                              <div className="flex items-center justify-between text-slate-500 text-[10px]">
                                <span>{item.p.startTime} ~ {item.p.endTime}</span>
                                <span className="font-bold text-slate-700">{item.booking.teacherName} 선생님</span>
                              </div>
                              {item.booking.memo && (
                                <p className="text-[10px] text-slate-400 truncate mt-0.5 border-l-2 border-indigo-200 pl-1.5 italic">
                                  {item.booking.memo}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>

        </aside>

        {/* Main Matrix Section */}
        <section id="reservation_matrix_section" className="flex-1 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col overflow-hidden relative min-h-[500px] md:min-h-0">
          
          {/* Matrix Toolbar */}
          <div className="p-3 border-b border-slate-150 flex items-center justify-between bg-slate-50/50 flex-shrink-0">
            <div className="flex items-center gap-2">
              {selectedBoardRoom && (
                <button
                  type="button"
                  onClick={() => setSelectedBoardRoom(null)}
                  className="px-2.5 py-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-650 hover:text-slate-800 rounded-md text-xs font-black transition-all flex items-center gap-1 cursor-pointer shadow-3xs"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">전체 특별실</span>
                </button>
              )}
              <span className="px-3 py-1 bg-white border border-slate-200 rounded-md text-xs font-bold text-slate-700 shadow-sm flex items-center gap-1.5 font-mono">
                {selectedDate.getFullYear()}년 {selectedDate.getMonth() + 1}월 {selectedDate.getDate()}일 ({getWeekDayKorean(selectedDate)}요일)
              </span>
            </div>
            <div className="flex gap-2">
              <div className="flex items-center space-x-1 bg-indigo-50/60 rounded-md px-2 py-1 text-[10px] text-indigo-850 border border-indigo-100/50">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
                <span className="font-bold">실시간 예약 신청 보드</span>
              </div>
            </div>
          </div>

          {/* 로딩 인디케이터 바 */}
          {dailyLoading && (
            <div className="absolute top-0 inset-x-0 h-0.5 bg-indigo-500 animate-pulse z-10" />
          )}

          {/* 반응형 룸 리스트 grid 및 하루 일과표 (bento -> 일과 타임라인) */}
          <div className="overflow-y-auto w-full pb-20 flex-1 bg-slate-50/20">
            {selectedBoardRoom === null ? (
              <div className="p-5 sm:p-6 lg:p-8 flex-1 space-y-6">
                <div>
                  <h4 className="text-xs font-black text-indigo-650 uppercase tracking-widest bg-indigo-50 inline-block px-2.5 py-1 rounded-md mb-2">SPECIAL ROOM LISTS</h4>
                  <p className="text-sm font-black text-slate-800">예약 및 운영 일과를 확인하실 특별실 단추를 선택해 주세요</p>
                  <p className="text-xs text-slate-450 font-medium">선택하시면 해당 특별실의 세부 탑재 교시와 대여 현황을 확인하고 접수할 수 있습니다.</p>
                </div>
                
                <div className={`grid gap-5 ${
                  settings.roomsPerRow === 1 ? 'grid-cols-1' :
                  settings.roomsPerRow === 2 ? 'grid-cols-1 sm:grid-cols-2' :
                  settings.roomsPerRow === 4 ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4' :
                  settings.roomsPerRow === 6 ? 'grid-cols-2 sm:grid-cols-4 md:grid-cols-6' :
                  'grid-cols-1 sm:grid-cols-2 md:grid-cols-3'
                }`}>
                  {settings.specialRooms.map((room, idx) => {
                    const totalPeriods = settings.periods.filter(p => p.allowed).length;
                    const bookedCount = settings.periods.filter(p => {
                      if (!p.allowed) return false;
                      const key = `${room}_${p.id}`;
                      return !!dailyReservations[key];
                    }).length;

                    const percent = totalPeriods > 0 ? Math.round((bookedCount / totalPeriods) * 100) : 0;
                    const isFull = bookedCount === totalPeriods && totalPeriods > 0;

                    const colors = [
                      {
                        border: 'hover:border-indigo-400 border-slate-200/80',
                        bg: 'bg-white',
                        headerBg: 'bg-indigo-50/40 border-b border-indigo-100/50',
                        badge: 'bg-indigo-100/60 text-indigo-700',
                        percentBar: 'bg-indigo-600',
                        text: 'text-indigo-805'
                      },
                      {
                        border: 'hover:border-emerald-400 border-slate-200/80',
                        bg: 'bg-white',
                        headerBg: 'bg-emerald-50/40 border-b border-emerald-100/50',
                        badge: 'bg-emerald-100/60 text-emerald-700',
                        percentBar: 'bg-emerald-500',
                        text: 'text-emerald-805'
                      },
                      {
                        border: 'hover:border-amber-400 border-slate-200/80',
                        bg: 'bg-white',
                        headerBg: 'bg-amber-50/40 border-b border-amber-100/50',
                        badge: 'bg-amber-100/60 text-amber-750',
                        percentBar: 'bg-amber-500',
                        text: 'text-amber-805'
                      },
                      {
                        border: 'hover:border-sky-450 border-slate-200/80',
                        bg: 'bg-white',
                        headerBg: 'bg-sky-50/40 border-b border-sky-100/50',
                        badge: 'bg-sky-100/60 text-sky-700',
                        percentBar: 'bg-sky-600',
                        text: 'text-sky-805'
                      },
                      {
                        border: 'hover:border-rose-400 border-slate-200/80',
                        bg: 'bg-white',
                        headerBg: 'bg-rose-50/40 border-b border-rose-100/50',
                        badge: 'bg-rose-100/60 text-rose-700',
                        percentBar: 'bg-rose-600',
                        text: 'text-rose-805'
                      }
                    ];
                    const theme = colors[idx % colors.length];

                    return (
                      <motion.div
                        key={`grid-room-${room}`}
                        onClick={() => setSelectedBoardRoom(room)}
                        whileHover={{ y: -4, scale: 1.015 }}
                        className={`rounded-2xl border ${theme.border} ${theme.bg} shadow-xs hover:shadow-md transition-all overflow-hidden flex flex-col justify-between cursor-pointer group`}
                      >
                        <div>
                          <div className={`p-4 ${theme.headerBg} flex items-center justify-between`}>
                            <div className="flex items-center gap-2.5">
                              <span className={`p-2 rounded-xl ${theme.badge} font-black flex items-center justify-center`}>
                                <MapPin className="w-4 h-4" />
                              </span>
                              <span className="font-extrabold text-slate-800 text-[13px] tracking-tight group-hover:text-indigo-650 transition-colors">
                                {room}
                              </span>
                            </div>
                            {isFull ? (
                              <span className="text-[10px] font-bold bg-rose-50 text-rose-650 px-2 py-0.5 rounded-full border border-rose-100">
                                예약 마감
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold bg-emerald-50 text-emerald-650 px-2 py-0.5 rounded-full border border-emerald-100">
                                대여 가능
                              </span>
                            )}
                          </div>
                          
                          <div className="p-4 space-y-3">
                            <div className="flex justify-between items-end text-xs">
                              <span className="text-slate-400 font-bold">오전/오후 대여율</span>
                              <span className="text-slate-800 font-black">
                                {bookedCount} <span className="text-slate-350 font-normal">/</span> {totalPeriods} 교시 ({percent}%)
                              </span>
                            </div>
                            <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full ${theme.percentBar} rounded-full transition-all duration-500`}
                                style={{ width: `${percent}%` }}
                              />
                            </div>
                          </div>
                        </div>

                        <div className="px-4 pb-4">
                          <div
                            className="w-full py-2.5 rounded-xl border border-transparent text-xs font-black text-center transition-all flex items-center justify-center gap-1 bg-slate-50 text-slate-650 group-hover:bg-indigo-600 group-hover:text-white cursor-pointer"
                          >
                            <span>운영 일과표 개방 및 예약</span>
                            <ChevronRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="p-5 sm:p-6 lg:p-8 flex-1 space-y-6">
                {/* 헤더 및 요약 정보 */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-150 pb-4">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setSelectedBoardRoom(null)}
                      className="p-2 border border-slate-200 hover:border-slate-350 hover:bg-slate-50 transition-all rounded-xl text-slate-500 hover:text-slate-800 cursor-pointer bg-white flex items-center justify-center"
                      title="특별실 전체 목록으로 돌아가기"
                    >
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="p-1 px-2.5 bg-indigo-50 border border-indigo-100 text-indigo-700 rounded-lg text-xs font-black">
                          {selectedBoardRoom}
                        </span>
                        <h4 className="text-sm font-black text-slate-800">하루 일과표 및 예약 현황</h4>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">교시별로 비어있는 운영시간 단추를 탭하여 대여 신청서를 접수해 주십시오.</p>
                    </div>
                  </div>

                  {/* 퀵 특별실 변경 셀렉터 */}
                  <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-200">
                    <span className="text-[10px] font-black text-slate-500 px-1.5">특별실 신속 전환:</span>
                    <select
                      value={selectedBoardRoom}
                      onChange={(e) => setSelectedBoardRoom(e.target.value)}
                      className="text-xs bg-white border border-slate-200 rounded-lg p-1.5 font-bold text-slate-700 outline-hidden focus:ring-1 focus:ring-indigo-500 cursor-pointer focus:border-indigo-500"
                    >
                      {settings.specialRooms.map((r) => (
                        <option key={`quick-opt-${r}`} value={r}>{r}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* 일과 시간 대 세로 타임라인 카드 */}
                <div className="space-y-3 max-w-3xl mx-auto">
                  {settings.periods.map((period) => {
                    const compoundKey = `${selectedBoardRoom}_${period.id}`;
                    const booking = dailyReservations[compoundKey];

                    if (!period.allowed) {
                      return (
                        <div
                          key={`timeline-${period.id}`}
                          className="flex items-stretch border border-slate-150 rounded-2xl bg-slate-50/50 opacity-60 overflow-hidden"
                        >
                          {/* 교시부 */}
                          <div className="w-[90px] sm:w-[110px] bg-slate-100/50 p-4.5 flex flex-col justify-center items-center text-center border-r border-slate-150 flex-shrink-0 select-none">
                            <span className="text-xs font-black text-slate-500">{period.name}</span>
                            <span className="text-[9px] text-slate-400 font-mono mt-0.5">{period.startTime} ~ {period.endTime}</span>
                          </div>
                          {/* 본문부 */}
                          <div className="flex-1 p-4.5 flex items-center gap-2 select-none">
                            <Lock className="w-3.5 h-3.5 text-slate-400" />
                            <span className="text-xs font-extrabold text-slate-400">학업 또는 기본 일과 조정 외 예약 불가 시간</span>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={`timeline-${period.id}`}
                        className="flex items-stretch border border-slate-200 hover:border-indigo-350 rounded-2xl bg-white shadow-2xs overflow-hidden transition-all duration-200 group/timeline"
                      >
                        {/* 교시부 */}
                        <div className="w-[90px] sm:w-[110px] bg-slate-50 p-4.5 flex flex-col justify-center items-center text-center border-r border-slate-200 flex-shrink-0 select-none">
                          <span className="text-xs font-black text-indigo-900">{period.name}</span>
                          <span className="text-[9px] text-indigo-500/80 font-mono mt-0.5">{period.startTime} ~ {period.endTime}</span>
                        </div>

                        {/* 우측 예약 현황/신청 카드내역 */}
                        <div className="flex-1 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          {booking ? (
                            <>
                              <div className="space-y-1.5 flex-1 min-w-0 pr-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="bg-indigo-650 text-white text-[9.5px] font-black px-2 py-0.5 rounded-md">
                                    {booking.teacherClass}
                                  </span>
                                  <span className="text-xs font-black text-slate-800">
                                    {booking.teacherName} 선생님 대여 완료
                                  </span>
                                </div>
                                {booking.memo && (
                                  <p className="text-[11px] text-slate-550 border-l-2 border-indigo-200 pl-2 italic truncate" title={booking.memo}>
                                    {booking.memo}
                                  </p>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => openBookingForm(selectedBoardRoom, period)}
                                className="sm:self-center px-3 py-1.5 rounded-lg border border-indigo-150 bg-indigo-50/50 hover:bg-indigo-50 text-indigo-700 text-[11px] font-black transition-all cursor-pointer flex-shrink-0 self-start"
                              >
                                상세 정보 및 취소
                              </button>
                            </>
                          ) : (
                            <>
                              <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse" />
                                <span className="text-xs font-bold text-slate-450 group-hover/timeline:text-indigo-650 transition-colors">
                                  시간대 비어 있음 · 안전 대여 운영
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => openBookingForm(selectedBoardRoom, period)}
                                className="px-4 py-1.5 rounded-lg border border-slate-200 hover:border-indigo-400 bg-white hover:bg-indigo-50/20 text-slate-600 hover:text-indigo-600 text-[11px] font-black transition-all flex items-center gap-1 cursor-pointer self-start sm:self-center"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                <span>예약하기</span>
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* 하단 저작권 및 문의 바 */}
      <footer className="bg-white border-t border-slate-200 py-3.5 px-6 flex flex-col sm:flex-row items-center justify-between text-[11px] text-slate-500 font-semibold flex-shrink-0">
        <p className="tracking-wide text-slate-600">{settings.copyright}</p>
        <div className="mt-2 sm:mt-0 flex items-center space-x-2 bg-slate-50 border border-slate-250/30 rounded-full px-3 py-1 shadow-2xs">
          <Mail className="w-3.5 h-3.5 text-indigo-500" />
          <span>행정 문의처: <strong className="text-slate-850 font-black">{settings.contactEmail}</strong></span>
        </div>
      </footer>

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
                    {dailyReservations[`${activeBookingCell.room}_${activeBookingCell.period.id}`] ? "특별실 대여 예약 수정" : "특별실 대여 예약 신청"}
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

                {/* 에러 메시지 알림 배너 */}
                {formValidationError && (
                  <motion.div
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-3 bg-rose-50 rounded-xl border border-rose-100 flex items-center gap-2 text-[11px] text-rose-700 font-bold"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse flex-shrink-0" />
                    <span>{formValidationError}</span>
                  </motion.div>
                )}

                {/* 등록 관리 버튼 */}
                <div className="pt-3 border-t border-slate-100 flex space-x-2">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveBookingCell(null);
                      setFormValidationError(null);
                    }}
                    disabled={isSaving}
                    className="flex-1 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-bold rounded-xl transition-all cursor-pointer"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={saveReservation}
                    disabled={isSaving}
                    className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-xs font-extrabold rounded-xl transition-all flex items-center justify-center space-x-1.5 shadow-md shadow-indigo-500/10 cursor-pointer"
                  >
                    {isSaving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                    <span>{isSaving ? "저장 중..." : (dailyReservations[`${activeBookingCell.room}_${activeBookingCell.period.id}`] ? "수정하기" : "예약하기")}</span>
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
                    className="flex-1 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-bold rounded-xl transition-all cursor-pointer"
                  >
                    메뉴 닫기
                  </button>
                  <button
                    onClick={startEditingReservation}
                    disabled={isSaving}
                    className="py-2.5 px-3.5 bg-indigo-50 border border-slate-100 text-indigo-600 hover:bg-indigo-100 text-xs font-extrabold rounded-xl transition-all flex items-center justify-center space-x-1 cursor-pointer"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    <span>예약 수정</span>
                  </button>
                  <button
                    onClick={() => cancelReservation(showReservationDetail.room, showReservationDetail.period.id)}
                    disabled={isSaving}
                    className="py-2.5 px-3.5 bg-rose-50 border border-slate-100 text-rose-600 hover:bg-rose-100 text-xs font-extrabold rounded-xl transition-all flex items-center justify-center space-x-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
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

                        <div className="space-y-1">
                          <label className="block text-xs font-bold text-slate-700">메인페이지 우측 창특별실 배치 열(Columns) 수</label>
                          <select
                            value={editGeneral.roomsPerRow || 3}
                            onChange={(e) => setEditGeneral({ ...editGeneral, roomsPerRow: parseInt(e.target.value, 10) })}
                            className="w-full p-2.5 text-xs text-slate-800 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 bg-white cursor-pointer"
                          >
                            <option value={1}>1열 배치</option>
                            <option value={2}>2열 배치</option>
                            <option value={3}>3열 배치 (기본값)</option>
                            <option value={4}>4열 배치</option>
                            <option value={6}>6열 배치</option>
                          </select>
                          <p className="text-[10px] text-slate-450 leading-relaxed">
                            우측 메인 대시보드 창에 특별실 목록 카드를 한 줄(열)에 몇 개씩 보여줄지 지정합니다. (기본 3열)
                          </p>
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
                          <p className="text-[10px] text-slate-400">수정 / 삭제 시, 메인 예약 보드 칼럼에도 실시간 업데이트됩니다.</p>
                          
                          <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
                            {settings.specialRooms.map((room) => (
                              <div key={`room-list-${room}`} className="p-2.5 bg-white flex items-center justify-between text-xs min-h-[44px]">
                                {editingRoom === room ? (
                                  <div className="flex items-center gap-1.5 w-full">
                                    <input
                                      type="text"
                                      value={editingRoomNameInput}
                                      onChange={(e) => setEditingRoomNameInput(e.target.value)}
                                      className="flex-1 px-2.5 py-1.5 text-xs text-slate-800 border border-indigo-300 rounded-lg focus:ring-1 focus:ring-indigo-500 outline-hidden bg-indigo-50/10 font-bold"
                                      autoFocus
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          saveEditedRoomName(room);
                                        } else if (e.key === 'Escape') {
                                          setEditingRoom(null);
                                        }
                                      }}
                                    />
                                    <button
                                      type="button"
                                      onClick={() => saveEditedRoomName(room)}
                                      className="p-1.5 hover:bg-green-50 text-green-600 rounded-lg transition-all cursor-pointer"
                                      title="저장"
                                    >
                                      <Check className="w-4 h-4" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingRoom(null)}
                                      className="p-1.5 hover:bg-slate-100 text-slate-400 rounded-lg transition-all cursor-pointer"
                                      title="취소"
                                    >
                                      <X className="w-4 h-4" />
                                    </button>
                                  </div>
                                ) : (
                                  <>
                                    <span className="font-bold text-slate-800 pl-1">{room}</span>
                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingRoom(room);
                                          setEditingRoomNameInput(room);
                                        }}
                                        className="p-1.5 hover:bg-indigo-50 text-slate-400 hover:text-indigo-650 rounded-lg transition-all cursor-pointer"
                                        title="수정"
                                      >
                                        <Edit2 className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => removeSpecialRoom(room)}
                                        className="p-1.5 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg transition-all cursor-pointer"
                                        title="삭제"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </>
                                )}
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
                          <p className="text-[10px] text-slate-400">학급명을 더블클릭하거나 우측 아이콘을 클릭하여 수정할 수 있습니다.</p>
                          
                          <div className="border border-slate-200 rounded-xl bg-slate-50 p-2 max-h-[300px] overflow-y-auto grid grid-cols-2 gap-2">
                            {settings.classes.map((className) => (
                              <div
                                key={`class-list-${className}`}
                                className="p-2 bg-white border border-slate-100 rounded-lg flex items-center justify-between text-xs shadow-2xs min-h-[44px]"
                              >
                                {editingClass === className ? (
                                  <div className="flex items-center gap-1 w-full">
                                    <input
                                      type="text"
                                      value={editingClassNameInput}
                                      onChange={(e) => setEditingClassNameInput(e.target.value)}
                                      className="flex-1 px-1.5 py-1 text-xs text-slate-800 border border-indigo-300 rounded-lg focus:ring-1 focus:ring-indigo-500 outline-hidden bg-indigo-50/10 font-bold"
                                      autoFocus
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          saveEditedClassName(className);
                                        } else if (e.key === 'Escape') {
                                          setEditingClass(null);
                                        }
                                      }}
                                    />
                                    <button
                                      type="button"
                                      onClick={() => saveEditedClassName(className)}
                                      className="p-1 hover:bg-green-50 text-green-600 rounded transition-all cursor-pointer flex-shrink-0"
                                      title="저장"
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingClass(null)}
                                      className="p-1 hover:bg-slate-100 text-slate-400 rounded transition-all cursor-pointer flex-shrink-0"
                                      title="취소"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                ) : (
                                  <>
                                    <span 
                                      className="font-semibold text-slate-700 truncate max-w-[110px] cursor-pointer"
                                      onDoubleClick={() => {
                                        setEditingClass(className);
                                        setEditingClassNameInput(className);
                                      }}
                                      title="더블클릭하여 수정 가능"
                                    >
                                      {className}
                                    </span>
                                    <div className="flex items-center gap-0.5">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingClass(className);
                                          setEditingClassNameInput(className);
                                        }}
                                        className="p-1.5 hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 rounded-lg transition-all flex-shrink-0 cursor-pointer"
                                        title="수정"
                                      >
                                        <Edit2 className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => removeClassItem(className)}
                                        className="p-1.5 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg transition-all flex-shrink-0 cursor-pointer"
                                        title="삭제"
                                      >
                                        <X className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>

                      </div>
                    )}

                    {/* 탭 본문 4. 기본 일과 관리 */}
                    {adminSectionTab === 'periods' && (
                      <div className="space-y-4 animate-fadeIn">
                        <label className="block text-xs font-extrabold text-slate-700">새로운 일과(교시) 등록</label>
                        <div className="p-3 bg-indigo-50/40 rounded-xl border border-indigo-100 flex flex-col sm:flex-row gap-2.5 items-end">
                          <div className="flex-1 space-y-1 w-full">
                            <span className="block text-[10px] font-bold text-slate-500">교시명</span>
                            <input
                              type="text"
                              value={newPeriodName}
                              onChange={(e) => setNewPeriodName(e.target.value)}
                              placeholder="예: 7교시"
                              className="w-full p-2 text-xs border border-slate-200 rounded-lg bg-white"
                            />
                          </div>
                          <div className="w-full sm:w-[80px] space-y-1">
                            <span className="block text-[10px] font-bold text-slate-500">시작 시간</span>
                            <input
                              type="text"
                              value={newPeriodStartTime}
                              onChange={(e) => setNewPeriodStartTime(e.target.value)}
                              placeholder="15:10"
                              className="w-full p-2 text-xs text-center border border-slate-200 rounded-lg bg-white font-mono"
                            />
                          </div>
                          <div className="w-full sm:w-[80px] space-y-1">
                            <span className="block text-[10px] font-bold text-slate-500">종료 시간</span>
                            <input
                              type="text"
                              value={newPeriodEndTime}
                              onChange={(e) => setNewPeriodEndTime(e.target.value)}
                              placeholder="15:50"
                              className="w-full p-2 text-xs text-center border border-slate-200 rounded-lg bg-white font-mono"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={addPeriodItem}
                            className="w-full sm:w-auto px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-all h-[38px] flex-shrink-0 cursor-pointer"
                          >
                            추가
                          </button>
                        </div>

                        <div className="mt-4">
                          <label className="block text-xs font-extrabold text-slate-700">기존 등록된 일과 목록 및 변경</label>
                          <p className="text-[10px] text-slate-400">교시명 혹은 일과 시간을 우측 연필 수정 단추를 통해 변경 가능하며, 예약 가능 여부도 제어해 즉시 배정할 수 있습니다.</p>
                        </div>

                        <div className="space-y-3">
                          {settings.periods.map((period) => (
                            <div
                              key={`period-manage-${period.id}`}
                              className="p-3 border border-slate-200/80 rounded-xl bg-white space-y-2.5 shadow-2xs"
                            >
                              {editingPeriodId === period.id ? (
                                <div className="space-y-3">
                                  <div className="flex items-center justify-between gap-2.5">
                                    <div className="flex-1">
                                      <span className="block text-[10px] text-slate-400 font-bold mb-1">교시명</span>
                                      <input
                                        type="text"
                                        value={editingPeriodNameInput}
                                        onChange={(e) => setEditingPeriodNameInput(e.target.value)}
                                        className="w-full p-2 text-xs font-bold text-slate-800 bg-indigo-50/10 border border-indigo-300 rounded-lg outline-hidden focus:ring-1 focus:ring-indigo-500 font-sans"
                                        placeholder="예: 1교시"
                                        autoFocus
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            saveEditedPeriod(period.id);
                                          } else if (e.key === 'Escape') {
                                            setEditingPeriodId(null);
                                          }
                                        }}
                                      />
                                    </div>
                                    <div className="flex items-end gap-1.5 pt-4">
                                      <button
                                        type="button"
                                        onClick={() => saveEditedPeriod(period.id)}
                                        className="p-2 hover:bg-green-50 text-green-600 rounded-lg transition-all cursor-pointer border border-green-200"
                                        title="저장"
                                      >
                                        <Check className="w-4 h-4" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setEditingPeriodId(null)}
                                        className="p-2 hover:bg-slate-100 text-slate-450 rounded-lg transition-all cursor-pointer border border-slate-200"
                                        title="취소"
                                      >
                                        <X className="w-4 h-4" />
                                      </button>
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-2 gap-2">
                                    <div className="space-y-1">
                                      <span className="block text-[10px] text-slate-400 font-extrabold uppercase">시작 시간</span>
                                      <input
                                        type="text"
                                        value={editingPeriodStartTimeInput}
                                        onChange={(e) => setEditingPeriodStartTimeInput(e.target.value)}
                                        placeholder="09:00"
                                        className="w-full p-2 text-xs text-center border border-slate-200 rounded-lg bg-white font-mono"
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') saveEditedPeriod(period.id);
                                        }}
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <span className="block text-[10px] text-slate-400 font-extrabold uppercase">종료 시간</span>
                                      <input
                                        type="text"
                                        value={editingPeriodEndTimeInput}
                                        onChange={(e) => setEditingPeriodEndTimeInput(e.target.value)}
                                        placeholder="09:40"
                                        className="w-full p-2 text-xs text-center border border-slate-200 rounded-lg bg-white font-mono"
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') saveEditedPeriod(period.id);
                                        }}
                                      />
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <span className="p-1 px-2.5 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-black">
                                        {period.name}
                                      </span>
                                    </div>

                                    <div className="flex items-center gap-3">
                                      <label className="flex items-center space-x-1.5 cursor-pointer text-xs font-bold text-slate-605 select-none hover:text-indigo-600 transition-colors">
                                        <input
                                          type="checkbox"
                                          checked={period.allowed}
                                          onChange={() => togglePeriodAllowed(period.id, period.allowed)}
                                          className="w-4 h-4 text-indigo-600 border-slate-300 rounded-sm focus:ring-indigo-500 cursor-pointer"
                                        />
                                        <span>예약 허용</span>
                                      </label>

                                      <div className="flex items-center gap-1">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setEditingPeriodId(period.id);
                                            setEditingPeriodNameInput(period.name);
                                            setEditingPeriodStartTimeInput(period.startTime);
                                            setEditingPeriodEndTimeInput(period.endTime);
                                          }}
                                          className="p-1.5 hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 rounded-lg transition-all cursor-pointer"
                                          title="수정"
                                        >
                                          <Edit2 className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => removePeriodItem(period.id)}
                                          className="p-1.5 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg transition-all cursor-pointer"
                                          title="삭제"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="flex items-center justify-between bg-slate-50 rounded-lg p-2.5 text-xs border border-slate-100 font-medium">
                                    <span className="text-slate-500 font-semibold">운영 시간</span>
                                    <span className="text-slate-800 font-mono font-bold">
                                      {period.startTime} ~ {period.endTime}
                                    </span>
                                  </div>
                                </>
                              )}
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

      {/* 글로벌 비차단 예쁜 슬라이드 토스트 배너 */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            key="global-toast-banner"
            initial={{ opacity: 0, scale: 0.9, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 30 }}
            className="fixed bottom-6 right-6 z-[9999] flex items-center gap-3 px-4.5 py-3.5 rounded-2xl shadow-xl border bg-white max-w-sm"
            style={{
              borderColor: toastMessage.type === 'success' ? '#86efac' : '#fecaca',
              backgroundColor: toastMessage.type === 'success' ? '#f0fdf4' : '#fff1f2',
            }}
          >
            {toastMessage.type === 'success' ? (
              <span className="p-1 px-1.5 bg-emerald-100 rounded-lg text-emerald-700 text-xs font-black">✓</span>
            ) : (
              <span className="p-1 px-1.5 bg-rose-100 rounded-lg text-rose-700 text-xs font-black">!</span>
            )}
            <p className="text-xs font-bold text-slate-800 leading-normal">{toastMessage.text}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 2차 커스텀 삭제 확인 팝업 (iFrame alert/confirm 차단 우회 보호용) */}
      <AnimatePresence>
        {deleteConfirmTarget && (
          <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDeleteConfirmTarget(null)}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs cursor-pointer"
            />
            
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              className="bg-white rounded-2xl shadow-2xl border border-rose-100 max-w-md w-full relative z-10 overflow-hidden"
            >
              <div className="bg-rose-50 p-4 border-b border-rose-100">
                <h4 className="text-sm font-black text-rose-700">
                  ⚠ 특별실 예약 대여 취소 확인
                </h4>
              </div>
              
              <div className="p-5 space-y-4">
                <p className="text-xs font-semibold text-slate-700 leading-relaxed">
                  선택하신 <strong className="text-indigo-750">{deleteConfirmTarget.room}</strong>의 예약을 말소하고 반납하시겠습니까?
                  <br />취소 시 동일 시간대에 다른 선생님이 신규로 예약을 신청하실 수 있게 개방됩니다.
                </p>

                {deleteConfirmTarget.res && (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400 font-bold">대여 타겟</span>
                      <span className="text-slate-700 font-black">{deleteConfirmTarget.res.teacherClass} {deleteConfirmTarget.res.teacherName} 선생님</span>
                    </div>
                    {deleteConfirmTarget.res.memo && (
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-400 font-bold">메모 목적</span>
                        <span className="text-slate-500 italic font-semibold truncate max-w-[190px]">{deleteConfirmTarget.res.memo}</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex space-x-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setDeleteConfirmTarget(null)}
                    className="flex-1 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-bold rounded-xl transition-all cursor-pointer"
                  >
                    아니오, 유지합니다
                  </button>
                  <button
                    type="button"
                    onClick={() => executeCancelReservation(deleteConfirmTarget.room, deleteConfirmTarget.periodId)}
                    disabled={isSaving}
                    className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 text-white text-xs font-extrabold rounded-xl transition-all flex items-center justify-center space-x-1.5 shadow-md shadow-rose-500/10 cursor-pointer"
                  >
                    {isSaving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                    <span>예, 취소합니다</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
    </div>
  );
}
