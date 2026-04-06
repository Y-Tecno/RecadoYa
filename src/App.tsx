/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  doc, 
  setDoc, 
  getDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
  getDocFromServer
} from 'firebase/firestore';
import { useAuthState } from 'react-firebase-hooks/auth';
import { auth, db } from './firebase';
import { cn } from './lib/utils';
import { 
  Plus, 
  LogOut, 
  LogIn, 
  HandCoins, 
  MapPin, 
  Clock, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle,
  User as UserIcon,
  ShieldAlert,
  Star,
  MessageSquare,
  Trash2
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

// --- Types ---
interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  isBanned: boolean;
  rating: number;
  completedErrands: number;
}

interface Errand {
  id: string;
  title: string;
  description: string;
  price: number;
  location: string;
  city: string;
  category: 'compras' | 'transporte' | 'hogar' | 'tecnologia' | 'otros';
  status: 'open' | 'pending' | 'accepted' | 'completed' | 'cancelled';
  creatorId: string;
  creatorName: string;
  candidateId?: string;
  candidateName?: string;
  counterPrice?: number;
  counterOfferStatus?: 'pending' | 'accepted' | 'rejected';
  acceptedById?: string;
  acceptedByName?: string;
  createdAt: Timestamp;
  completedAt?: Timestamp;
  hasBeenReviewed?: boolean;
}

interface Review {
  id: string;
  errandId: string;
  reviewerId: string;
  revieweeId: string;
  rating: number;
  comment: string;
  createdAt: Timestamp;
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
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

// --- Error Handling ---
function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Components ---

function ErrorBoundary({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-red-50 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center">
        <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 mb-2">¡Ups! Algo salió mal</h2>
        <p className="text-gray-600 mb-6">
          {error.message.includes('insufficient permissions') 
            ? "No tienes permisos para realizar esta acción o tu cuenta ha sido restringida."
            : "Ha ocurrido un error inesperado. Por favor, inténtalo de nuevo."}
        </p>
        <button
          onClick={reset}
          className="w-full bg-red-600 text-white py-3 rounded-xl font-semibold hover:bg-red-700 transition-colors"
        >
          Reintentar
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [user, loading, error] = useAuthState(auth);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [errands, setErrands] = useState<Errand[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [cityFilter, setCityFilter] = useState('');
  const [searchCity, setSearchCity] = useState('');
  const [formCity, setFormCity] = useState('');
  const [formLocation, setFormLocation] = useState('');
  const [keywordFilter, setKeywordFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('todos');
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [profileReviews, setProfileReviews] = useState<Review[]>([]);
  const [activeTab, setActiveTab] = useState<'available' | 'my-errands' | 'accepted-by-me'>('available');
  const [appError, setAppError] = useState<Error | null>(null);
  const [reviewingErrand, setReviewingErrand] = useState<Errand | null>(null);
  const [deletingErrandId, setDeletingErrandId] = useState<string | null>(null);
  const [acceptingErrandId, setAcceptingErrandId] = useState<string | null>(null);
  const [counterOfferPrice, setCounterOfferPrice] = useState<string>('');
  const [userRatings, setUserRatings] = useState<Record<string, { rating: number; count: number }>>({});

  const isAdmin = user?.email === "alvaro12fb@gmail.com";

  // Fetch all user ratings for display
  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(collection(db, 'users'), (snapshot) => {
      const ratings: Record<string, { rating: number; count: number }> = {};
      snapshot.docs.forEach(d => {
        const data = d.data();
        ratings[d.id] = { rating: data.rating || 0, count: data.completedErrands || 0 };
      });
      setUserRatings(ratings);
    });
    return () => unsub();
  }, [user]);

  // Test connection
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. ");
        }
      }
    }
    testConnection();
  }, []);

  // Profile Sync
  useEffect(() => {
    if (!user) {
      setProfile(null);
      return;
    }

    const unsub = onSnapshot(doc(db, 'users', user.uid), (docSnap) => {
      if (docSnap.exists()) {
        setProfile(docSnap.data() as UserProfile);
      } else {
        // Create profile if it doesn't exist
        const newProfile: UserProfile = {
          uid: user.uid,
          email: user.email || '',
          displayName: user.displayName || 'Usuario',
          photoURL: user.photoURL || '',
          isBanned: false,
          rating: 5,
          completedErrands: 0
        };
        setDoc(doc(db, 'users', user.uid), newProfile).catch(e => handleFirestoreError(e, OperationType.WRITE, `users/${user.uid}`));
      }
    }, (err) => handleFirestoreError(err, OperationType.GET, `users/${user.uid}`));

    return () => unsub();
  }, [user]);

  // Errands Subscription
  useEffect(() => {
    if (!user || profile?.isBanned) return;

    let q = query(collection(db, 'errands'), orderBy('createdAt', 'desc'));

    if (activeTab === 'my-errands') {
      q = query(collection(db, 'errands'), where('creatorId', '==', user.uid), orderBy('createdAt', 'desc'));
    } else if (activeTab === 'accepted-by-me') {
      // Show both accepted errands AND errands where I am a candidate
      const unsub1 = onSnapshot(query(collection(db, 'errands'), where('acceptedById', '==', user.uid), orderBy('createdAt', 'desc')), (snapshot) => {
        const accepted = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Errand));
        setErrands(prev => {
          const others = prev.filter(e => e.acceptedById !== user.uid);
          return [...others, ...accepted].sort((a, b) => b.createdAt?.toMillis() - a.createdAt?.toMillis());
        });
      });
      const unsub2 = onSnapshot(query(collection(db, 'errands'), where('candidateId', '==', user.uid), orderBy('createdAt', 'desc')), (snapshot) => {
        const pending = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Errand));
        setErrands(prev => {
          const others = prev.filter(e => e.candidateId !== user.uid);
          return [...others, ...pending].sort((a, b) => b.createdAt?.toMillis() - a.createdAt?.toMillis());
        });
      });
      return () => { unsub1(); unsub2(); };
    } else {
      q = query(collection(db, 'errands'), where('status', '==', 'open'), orderBy('createdAt', 'desc'));
    }

    const unsub = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Errand));
      setErrands(docs);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'errands'));

    return () => unsub();
  }, [user, activeTab, profile?.isBanned]);

  // Fetch reviews for selected profile
  useEffect(() => {
    if (!selectedProfileId) {
      setProfileReviews([]);
      return;
    }
    const q = query(
      collection(db, 'reviews'), 
      where('revieweeId', '==', selectedProfileId),
      orderBy('createdAt', 'desc')
    );
    const unsub = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Review));
      setProfileReviews(docs);
    });
    return () => unsub();
  }, [selectedProfileId]);

  const login = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (e) {
      console.error("Login failed", e);
    }
  };

  const logout = () => signOut(auth);

  const createErrand = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user || profile?.isBanned) return;

    const formData = new FormData(e.currentTarget);
    const newErrand = {
      title: formData.get('title') as string,
      description: formData.get('description') as string,
      price: Number(formData.get('price')),
      location: formData.get('location') as string,
      city: (formData.get('city') as string || '').toLowerCase().trim(),
      category: formData.get('category') as string,
      status: 'open',
      creatorId: user.uid,
      creatorName: user.displayName || 'Usuario',
      createdAt: serverTimestamp(),
    };

    try {
      await addDoc(collection(db, 'errands'), newErrand);
      setIsCreating(false);
      setFormCity('');
      setFormLocation('');
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, 'errands');
    }
  };

  const requestErrand = async (errandId: string) => {
    if (!user || profile?.isBanned) return;
    try {
      const updateData: any = {
        status: 'pending',
        candidateId: user.uid,
        candidateName: user.displayName || 'Usuario'
      };

      if (counterOfferPrice && !isNaN(Number(counterOfferPrice)) && Number(counterOfferPrice) > 0) {
        updateData.counterPrice = Number(counterOfferPrice);
        updateData.counterOfferStatus = 'pending';
      }

      await updateDoc(doc(db, 'errands', errandId), updateData);
      setAcceptingErrandId(null);
      setCounterOfferPrice('');
    } catch (e) {
      setAcceptingErrandId(null);
      try {
        handleFirestoreError(e, OperationType.UPDATE, `errands/${errandId}`);
      } catch (err) {
        setAppError(err as Error);
      }
    }
  };

  const approveErrand = async (errand: Errand) => {
    if (!user || profile?.isBanned) return;
    try {
      const updateData: any = {
        status: 'accepted',
        acceptedById: errand.candidateId,
        acceptedByName: errand.candidateName,
        candidateId: null,
        candidateName: null
      };

      if (errand.counterPrice && errand.counterOfferStatus === 'pending') {
        updateData.price = errand.counterPrice;
        updateData.counterOfferStatus = 'accepted';
      }

      await updateDoc(doc(db, 'errands', errand.id), updateData);
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `errands/${errand.id}`);
    }
  };

  const rejectErrand = async (errandId: string) => {
    if (!user || profile?.isBanned) return;
    try {
      const errand = errands.find(e => e.id === errandId);
      const updateData: any = {
        status: 'open',
        candidateId: null,
        candidateName: null
      };

      if (errand?.counterOfferStatus === 'pending') {
        updateData.counterOfferStatus = 'rejected';
      }

      await updateDoc(doc(db, 'errands', errandId), updateData);
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `errands/${errandId}`);
    }
  };

  const completeErrand = async (errandId: string) => {
    if (!user || profile?.isBanned) return;
    try {
      await updateDoc(doc(db, 'errands', errandId), {
        status: 'completed',
        completedAt: serverTimestamp()
      });
      
      // Open review modal if the current user is the creator
      const errand = errands.find(e => e.id === errandId);
      if (errand && errand.creatorId === user.uid) {
        setReviewingErrand(errand);
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `errands/${errandId}`);
    }
  };

  const submitReview = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user || !reviewingErrand) return;

    const formData = new FormData(e.currentTarget);
    const rating = Number(formData.get('rating'));
    const comment = formData.get('comment') as string;
    const revieweeId = reviewingErrand.acceptedById!;

    try {
      // 1. Add review
      await addDoc(collection(db, 'reviews'), {
        errandId: reviewingErrand.id,
        reviewerId: user.uid,
        revieweeId: revieweeId,
        rating,
        comment,
        createdAt: serverTimestamp()
      });

      // 2. Update errand
      await updateDoc(doc(db, 'errands', reviewingErrand.id), {
        hasBeenReviewed: true
      });

      // 3. Update user reputation (simplified client-side update)
      const revieweeDoc = await getDoc(doc(db, 'users', revieweeId));
      if (revieweeDoc.exists()) {
        const data = revieweeDoc.data();
        const currentRating = data.rating || 0;
        const currentCount = data.completedErrands || 0;
        const newCount = currentCount + 1;
        const newRating = ((currentRating * currentCount) + rating) / newCount;

        await updateDoc(doc(db, 'users', revieweeId), {
          rating: newRating,
          completedErrands: newCount
        });
      }

      setReviewingErrand(null);
      alert("¡Gracias por tu reseña!");
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'reviews');
    }
  };

  const deleteErrand = async (errandId: string) => {
    if (!user || profile?.isBanned) return;
    
    try {
      await deleteDoc(doc(db, 'errands', errandId));
      setDeletingErrandId(null);
    } catch (e) {
      setDeletingErrandId(null);
      try {
        handleFirestoreError(e, OperationType.DELETE, `errands/${errandId}`);
      } catch (err) {
        setAppError(err as Error);
      }
    }
  };

  const reportUser = async (errandId: string, reportedId: string) => {
    if (!user || profile?.isBanned) return;
    const reason = window.prompt("¿Por qué quieres denunciar a este usuario? (Si aceptó y no lo hizo, será baneado)");
    if (!reason) return;

    try {
      await addDoc(collection(db, 'reports'), {
        errandId,
        reporterId: user.uid,
        reportedId,
        reason,
        createdAt: serverTimestamp()
      });
      alert("Denuncia enviada. Revisaremos el caso.");
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, 'reports');
    }
  };

  if (appError) return <ErrorBoundary error={appError} reset={() => setAppError(null)} />;
  if (loading) return <div className="min-h-screen flex items-center justify-center bg-gray-50"><Clock className="animate-spin text-blue-600" /></div>;

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center p-4">
        <div className="bg-white p-10 rounded-3xl shadow-2xl max-w-md w-full text-center">
          <HandCoins className="w-20 h-20 text-blue-600 mx-auto mb-6" />
          <h1 className="text-4xl font-black text-gray-900 mb-4 tracking-tight">RecadoYa</h1>
          <p className="text-gray-600 mb-8 text-lg">
            Gana dinero ayudando a tus vecinos. Rápido, seguro y pago en mano.
          </p>
          <button
            onClick={login}
            className="w-full flex items-center justify-center gap-3 bg-gray-900 text-white py-4 rounded-2xl font-bold hover:bg-gray-800 transition-all transform hover:scale-[1.02] active:scale-95 shadow-lg"
          >
            <LogIn className="w-5 h-5" />
            Entrar con Google
          </button>
        </div>
      </div>
    );
  }

  if (profile?.isBanned) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center border-t-4 border-red-500">
          <ShieldAlert className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Cuenta Suspendida</h2>
          <p className="text-gray-600 mb-6">
            Tu cuenta ha sido eliminada automáticamente debido a denuncias por incumplimiento de recados aceptados.
          </p>
          <button
            onClick={logout}
            className="w-full bg-gray-900 text-white py-3 rounded-xl font-semibold hover:bg-gray-800"
          >
            Cerrar Sesión
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HandCoins className="w-8 h-8 text-blue-600" />
            <span className="text-xl font-black tracking-tight">RecadoYa</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 bg-gray-100 px-3 py-1.5 rounded-full">
              <img src={user.photoURL || ''} className="w-6 h-6 rounded-full" alt="" />
              <span className="text-sm font-medium">{user.displayName}</span>
            </div>
            <button onClick={logout} className="p-2 text-gray-500 hover:text-red-600 transition-colors">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Search Bar */}
        <div className="mb-6 space-y-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input 
                type="text" 
                placeholder="Ciudad (ej: Madrid)..." 
                value={searchCity}
                onChange={(e) => setSearchCity(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && setCityFilter(searchCity.toLowerCase().trim())}
                className="w-full pl-12 pr-4 py-4 rounded-2xl border border-gray-200 shadow-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium"
              />
            </div>
            <div className="relative flex-1">
              <MessageSquare className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input 
                type="text" 
                placeholder="¿Qué buscas? (ej: pan, arreglar)..." 
                value={keywordFilter}
                onChange={(e) => setKeywordFilter(e.target.value)}
                className="w-full pl-12 pr-4 py-4 rounded-2xl border border-gray-200 shadow-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium"
              />
            </div>
            <button 
              onClick={() => setCityFilter(searchCity.toLowerCase().trim())}
              className="bg-blue-600 text-white px-8 py-4 rounded-2xl font-bold hover:bg-blue-700 transition-all shadow-lg active:scale-95"
            >
              Filtrar
            </button>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {[
              { id: 'todos', label: 'Todos', icon: MapPin },
              { id: 'compras', label: 'Compras', icon: HandCoins },
              { id: 'transporte', label: 'Transporte', icon: Clock },
              { id: 'hogar', label: 'Hogar', icon: Plus },
              { id: 'tecnologia', label: 'Tecnología', icon: MessageSquare },
              { id: 'otros', label: 'Otros', icon: AlertTriangle },
            ].map((cat) => (
              <button
                key={cat.id}
                onClick={() => setCategoryFilter(cat.id)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all whitespace-nowrap border",
                  categoryFilter === cat.id
                    ? "bg-blue-50 border-blue-200 text-blue-600 shadow-sm"
                    : "bg-white border-gray-100 text-gray-500 hover:bg-gray-50"
                )}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {(cityFilter || keywordFilter || categoryFilter !== 'todos') && (
            <div className="flex items-center justify-between bg-blue-50/50 p-3 rounded-xl border border-blue-100">
              <div className="flex items-center gap-4 text-sm">
                {cityFilter && <span>Ciudad: <b className="text-blue-600 capitalize">{cityFilter}</b></span>}
                {keywordFilter && <span>Palabra: <b className="text-blue-600">{keywordFilter}</b></span>}
                {categoryFilter !== 'todos' && <span>Categoría: <b className="text-blue-600 capitalize">{categoryFilter}</b></span>}
              </div>
              <button 
                onClick={() => { setCityFilter(''); setSearchCity(''); setKeywordFilter(''); setCategoryFilter('todos'); }} 
                className="text-xs text-red-500 font-bold hover:underline"
              >
                Limpiar filtros
              </button>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-8 overflow-x-auto pb-2 scrollbar-hide">
          {[
            { id: 'available', label: 'Disponibles', icon: MapPin },
            { id: 'my-errands', label: 'Mis Pedidos', icon: Plus, hasBadge: errands.some(e => e.creatorId === user.uid && e.status === 'pending') },
            { id: 'accepted-by-me', label: 'Mis Tareas / Postulaciones', icon: CheckCircle2, hasBadge: errands.some(e => e.candidateId === user.uid) },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={cn(
                "relative flex items-center gap-2 px-5 py-2.5 rounded-full font-semibold transition-all whitespace-nowrap",
                activeTab === tab.id 
                  ? "bg-blue-600 text-white shadow-md" 
                  : "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200"
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
              {tab.hasBadge && (
                <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white animate-pulse" />
              )}
            </button>
          ))}
        </div>

        {/* Create Button */}
        {activeTab === 'my-errands' && !isCreating && (
          <button
            onClick={() => setIsCreating(true)}
            className="w-full mb-8 bg-white border-2 border-dashed border-gray-300 p-6 rounded-2xl flex flex-col items-center justify-center gap-2 text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-all group"
          >
            <div className="p-3 bg-gray-50 rounded-full group-hover:bg-blue-50 transition-colors">
              <Plus className="w-6 h-6" />
            </div>
            <span className="font-bold">Publicar nuevo recado</span>
          </button>
        )}

        {/* Create Form */}
        {isCreating && (
          <div className="bg-white p-6 rounded-2xl shadow-xl border border-gray-200 mb-8 animate-in fade-in slide-in-from-top-4 duration-300">
            <h2 className="text-xl font-bold mb-6">Nuevo Recado</h2>
            <form onSubmit={createErrand} className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">¿Qué necesitas?</label>
                <input name="title" required placeholder="Ej: Comprar pan y leche" className="w-full p-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Descripción detallada</label>
                <textarea name="description" required placeholder="Detalla el recado..." className="w-full p-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none h-24" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Categoría</label>
                <select name="category" required className="w-full p-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                  <option value="compras">Compras</option>
                  <option value="transporte">Transporte</option>
                  <option value="hogar">Hogar</option>
                  <option value="tecnologia">Tecnología</option>
                  <option value="otros">Otros</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">Precio (€)</label>
                  <input name="price" type="number" required placeholder="5" className="w-full p-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">Ciudad</label>
                  <input 
                    name="city" 
                    required 
                    placeholder="Ej: Madrid" 
                    value={formCity}
                    onChange={(e) => setFormCity(e.target.value)}
                    className="w-full p-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none" 
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Dirección / Punto de encuentro</label>
                <input 
                  name="location" 
                  required 
                  placeholder="Barrio / Calle" 
                  value={formLocation}
                  onChange={(e) => setFormLocation(e.target.value)}
                  className="w-full p-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none" 
                />
              </div>

              {/* Live Map Preview */}
              {(formCity || formLocation) && (
                <div className="animate-in fade-in zoom-in-95 duration-300">
                  <label className="block text-sm font-bold text-gray-700 mb-1">Vista previa del mapa</label>
                  <div className="rounded-xl overflow-hidden border border-gray-100 h-32 bg-gray-50">
                    <iframe
                      width="100%"
                      height="100%"
                      frameBorder="0"
                      style={{ border: 0 }}
                      src={`https://maps.google.com/maps?q=${encodeURIComponent(formLocation + (formLocation && formCity ? ', ' : '') + formCity)}&t=&z=13&ie=UTF8&iwloc=&output=embed`}
                      allowFullScreen
                      className="opacity-80 pointer-events-none"
                    ></iframe>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1 italic text-center">El mapa se actualizará mientras escribes</p>
                </div>
              )}
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setIsCreating(false)} className="flex-1 py-3 rounded-xl font-bold text-gray-600 hover:bg-gray-100 transition-colors">Cancelar</button>
                <button type="submit" className="flex-1 py-3 rounded-xl font-bold bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-lg">Publicar</button>
              </div>
            </form>
          </div>
        )}

        {/* Review Modal */}
        {reviewingErrand && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white p-8 rounded-3xl shadow-2xl max-w-md w-full animate-in zoom-in-95 duration-200">
              <div className="flex justify-between items-start mb-6">
                <h2 className="text-2xl font-bold">Valorar Recadero</h2>
                <button onClick={() => setReviewingErrand(null)} className="p-1 hover:bg-gray-100 rounded-full"><XCircle className="w-6 h-6 text-gray-400" /></button>
              </div>
              <p className="text-gray-600 mb-6">¿Cómo fue tu experiencia con <b>{reviewingErrand.acceptedByName}</b>?</p>
              <form onSubmit={submitReview} className="space-y-6">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-3">Calificación</label>
                  <div className="flex gap-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <label key={star} className="cursor-pointer group">
                        <input type="radio" name="rating" value={star} required className="hidden peer" />
                        <Star className="w-10 h-10 text-gray-200 peer-checked:text-yellow-400 peer-checked:fill-yellow-400 group-hover:text-yellow-300 transition-all" />
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Comentario (opcional)</label>
                  <textarea name="comment" placeholder="Escribe algo sobre el trabajo..." className="w-full p-4 rounded-2xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none h-32 resize-none" />
                </div>
                <button type="submit" className="w-full py-4 rounded-2xl font-bold bg-blue-600 text-white hover:bg-blue-700 transition-all shadow-lg active:scale-95">
                  Enviar Reseña
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {deletingErrandId && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white p-8 rounded-3xl shadow-2xl max-w-md w-full animate-in zoom-in-95 duration-200">
              <div className="flex justify-between items-start mb-6">
                <h2 className="text-2xl font-bold">¿Eliminar recado?</h2>
                <button onClick={() => setDeletingErrandId(null)} className="p-1 hover:bg-gray-100 rounded-full"><XCircle className="w-6 h-6 text-gray-400" /></button>
              </div>
              <p className="text-gray-600 mb-8">Esta acción no se puede deshacer. El recado desaparecerá de la lista pública.</p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setDeletingErrandId(null)} 
                  className="flex-1 py-4 rounded-2xl font-bold text-gray-600 hover:bg-gray-100 transition-all"
                >
                  Cancelar
                </button>
                <button 
                  onClick={() => deleteErrand(deletingErrandId)} 
                  className="flex-1 py-4 rounded-2xl font-bold bg-red-600 text-white hover:bg-red-700 transition-all shadow-lg active:scale-95"
                >
                  Eliminar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Accept Confirmation Modal */}
        {acceptingErrandId && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white p-8 rounded-3xl shadow-2xl max-w-md w-full animate-in zoom-in-95 duration-200">
              <div className="flex justify-between items-start mb-6">
                <h2 className="text-2xl font-bold">¿Postularse al recado?</h2>
                <button onClick={() => setAcceptingErrandId(null)} className="p-1 hover:bg-gray-100 rounded-full"><XCircle className="w-6 h-6 text-gray-400" /></button>
              </div>
              <p className="text-gray-600 mb-6">Al postularte, el dueño del recado verá tu valoración media y decidirá si acepta tu ayuda. El pago se acordará en mano al finalizar.</p>
              
              <div className="mb-8">
                <label className="block text-sm font-bold text-gray-700 mb-2">¿Quieres proponer otro precio? (Opcional)</label>
                <div className="relative">
                  <HandCoins className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input 
                    type="number" 
                    min="1"
                    placeholder="Precio propuesto en €" 
                    value={counterOfferPrice}
                    onChange={(e) => setCounterOfferPrice(e.target.value)}
                    className="w-full pl-12 pr-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none font-medium"
                  />
                </div>
                <p className="text-[10px] text-gray-400 mt-1 italic">Si lo dejas vacío, se mantendrá el precio original.</p>
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={() => setAcceptingErrandId(null)} 
                  className="flex-1 py-4 rounded-2xl font-bold text-gray-600 hover:bg-gray-100 transition-all"
                >
                  Cancelar
                </button>
                <button 
                  onClick={() => requestErrand(acceptingErrandId)} 
                  className="flex-1 py-4 rounded-2xl font-bold bg-blue-600 text-white hover:bg-blue-700 transition-all shadow-lg active:scale-95"
                >
                  Postularse
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Errands List */}
        <div className="grid gap-4">
          {errands
            .filter(e => {
              const matchesCity = !cityFilter || e.city === cityFilter;
              const matchesCategory = categoryFilter === 'todos' || e.category === categoryFilter;
              const matchesKeyword = !keywordFilter || 
                e.title.toLowerCase().includes(keywordFilter.toLowerCase()) || 
                e.description.toLowerCase().includes(keywordFilter.toLowerCase());
              return matchesCity && matchesCategory && matchesKeyword;
            })
            .length === 0 ? (
            <div className="text-center py-20 bg-white rounded-3xl border border-gray-100">
              <div className="bg-gray-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <Clock className="text-gray-400" />
              </div>
              <p className="text-gray-500 font-medium">No hay recados que coincidan con tu búsqueda.</p>
            </div>
          ) : (
            errands
              .filter(e => {
                const matchesCity = !cityFilter || e.city === cityFilter;
                const matchesCategory = categoryFilter === 'todos' || e.category === categoryFilter;
                const matchesKeyword = !keywordFilter || 
                  e.title.toLowerCase().includes(keywordFilter.toLowerCase()) || 
                  e.description.toLowerCase().includes(keywordFilter.toLowerCase());
                return matchesCity && matchesCategory && matchesKeyword;
              })
              .map((errand) => {
              const creatorRating = userRatings[errand.creatorId];
              const workerRating = errand.acceptedById ? userRatings[errand.acceptedById] : null;
              const candidateRating = errand.candidateId ? userRatings[errand.candidateId] : null;

              return (
                <div key={errand.id} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow group">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] uppercase tracking-widest font-black bg-blue-50 text-blue-600 px-2 py-0.5 rounded">
                          {errand.category}
                        </span>
                        <h3 className="text-lg font-bold text-gray-900 group-hover:text-blue-600 transition-colors">{errand.title}</h3>
                      </div>
                      <div className="flex items-center gap-3 text-sm text-gray-500">
                        <span className="flex items-center gap-1 capitalize font-medium text-blue-600"><MapPin className="w-3 h-3" /> {errand.city}</span>
                        <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {errand.location}</span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" /> 
                          {errand.createdAt ? formatDistanceToNow(errand.createdAt.toDate(), { addSuffix: true, locale: es }) : 'Recién publicado'}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={cn("text-2xl font-black", errand.counterPrice && errand.counterOfferStatus === 'pending' ? "text-gray-400 line-through text-lg" : "text-blue-600")}>
                        {errand.price}€
                      </div>
                      {errand.counterPrice && errand.counterOfferStatus === 'pending' && (
                        <div className="text-2xl font-black text-orange-600 animate-bounce">
                          {errand.counterPrice}€
                        </div>
                      )}
                      <span className={cn(
                        "text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full",
                        errand.status === 'open' ? "bg-green-100 text-green-700" :
                        errand.status === 'pending' ? "bg-blue-100 text-blue-700" :
                        errand.status === 'accepted' ? "bg-amber-100 text-amber-700" :
                        "bg-gray-100 text-gray-700"
                      )}>
                        {errand.status === 'open' ? 'Abierto' : errand.status === 'pending' ? 'Pendiente' : errand.status === 'accepted' ? 'En curso' : 'Completado'}
                      </span>
                    </div>
                  </div>

                  <p className="text-gray-600 mb-4 line-clamp-2">{errand.description}</p>

                  {/* Map Preview */}
                  <div className="mb-6 rounded-xl overflow-hidden border border-gray-100 h-32 bg-gray-50 relative group/map">
                    <iframe
                      width="100%"
                      height="100%"
                      frameBorder="0"
                      style={{ border: 0 }}
                      src={`https://maps.google.com/maps?q=${encodeURIComponent(errand.location + ', ' + errand.city)}&t=&z=13&ie=UTF8&iwloc=&output=embed`}
                      allowFullScreen
                      className="opacity-80 group-hover/map:opacity-100 transition-opacity pointer-events-none"
                    ></iframe>
                    <a 
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(errand.location + ', ' + errand.city)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover/map:bg-black/10 transition-all"
                    >
                      <span className="bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-lg text-xs font-bold text-gray-700 shadow-sm opacity-0 group-hover/map:opacity-100 transition-opacity flex items-center gap-1">
                        <MapPin className="w-3 h-3" /> Abrir en Google Maps
                      </span>
                    </a>
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-gray-50">
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => setSelectedProfileId(errand.creatorId)}
                          className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center hover:bg-gray-200 transition-colors"
                        >
                          <UserIcon className="w-4 h-4 text-gray-400" />
                        </button>
                        <div className="text-xs">
                          <button 
                            onClick={() => setSelectedProfileId(errand.creatorId)}
                            className="font-bold text-gray-700 flex items-center gap-1 hover:text-blue-600 transition-colors"
                          >
                            {errand.creatorName}
                            {creatorRating && creatorRating.count > 0 && (
                              <span className="flex items-center text-yellow-600 bg-yellow-50 px-1 rounded">
                                <Star className="w-2 h-2 fill-yellow-600" /> {creatorRating.rating.toFixed(1)}
                              </span>
                            )}
                          </button>
                          <p className="text-gray-400">Solicitante</p>
                        </div>
                      </div>

                      {errand.status === 'pending' && errand.candidateId && (
                        <div className="flex items-center gap-2 animate-pulse">
                          <button 
                            onClick={() => setSelectedProfileId(errand.candidateId!)}
                            className="w-8 h-8 bg-blue-50 rounded-full flex items-center justify-center hover:bg-blue-100 transition-colors"
                          >
                            <Clock className="w-4 h-4 text-blue-400" />
                          </button>
                          <div className="text-xs">
                            <button 
                              onClick={() => setSelectedProfileId(errand.candidateId!)}
                              className="font-bold text-gray-700 flex items-center gap-1 hover:text-blue-600 transition-colors"
                            >
                              {errand.candidateName}
                              {candidateRating && candidateRating.count > 0 && (
                                <span className="flex items-center text-yellow-600 bg-yellow-50 px-1 rounded">
                                  <Star className="w-2 h-2 fill-yellow-600" /> {candidateRating.rating.toFixed(1)}
                                </span>
                              )}
                            </button>
                            <p className="text-blue-600 font-medium">Quiere ayudar</p>
                            {errand.counterPrice && errand.counterOfferStatus === 'pending' && (
                              <p className="text-orange-600 font-black text-[10px] bg-orange-50 px-1 rounded inline-block mt-1">
                                PROPONE {errand.counterPrice}€
                              </p>
                            )}
                          </div>
                        </div>
                      )}

                      {errand.acceptedById && (
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => setSelectedProfileId(errand.acceptedById!)}
                            className="w-8 h-8 bg-blue-50 rounded-full flex items-center justify-center hover:bg-blue-100 transition-colors"
                          >
                            <CheckCircle2 className="w-4 h-4 text-blue-400" />
                          </button>
                          <div className="text-xs">
                            <button 
                              onClick={() => setSelectedProfileId(errand.acceptedById!)}
                              className="font-bold text-gray-700 flex items-center gap-1 hover:text-blue-600 transition-colors"
                            >
                              {errand.acceptedByName}
                              {workerRating && workerRating.count > 0 && (
                                <span className="flex items-center text-yellow-600 bg-yellow-50 px-1 rounded">
                                  <Star className="w-2 h-2 fill-yellow-600" /> {workerRating.rating.toFixed(1)}
                                </span>
                              )}
                            </button>
                            <p className="text-gray-400">Recadero</p>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2 self-end">
                      {activeTab === 'available' && errand.creatorId !== user.uid && errand.status === 'open' && (
                        <button
                          onClick={() => setAcceptingErrandId(errand.id)}
                          className="bg-blue-600 text-white px-6 py-2 rounded-xl font-bold hover:bg-blue-700 transition-colors shadow-sm"
                        >
                          Postularse
                        </button>
                      )}

                      {activeTab === 'my-errands' && errand.status === 'pending' && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => rejectErrand(errand.id)}
                            className="p-2 text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                            title="Rechazar"
                          >
                            <XCircle className="w-6 h-6" />
                          </button>
                          <button
                            onClick={() => approveErrand(errand)}
                            className="bg-blue-600 text-white px-4 py-2 rounded-xl font-bold hover:bg-blue-700 transition-colors shadow-sm"
                          >
                            {errand.counterPrice && errand.counterOfferStatus === 'pending' ? 'Aprobar Contraoferta' : 'Aprobar'}
                          </button>
                        </div>
                      )}

                      {activeTab === 'my-errands' && errand.status === 'accepted' && (
                        <button
                          onClick={() => completeErrand(errand.id)}
                          className="bg-green-600 text-white px-6 py-2 rounded-xl font-bold hover:bg-green-700 transition-colors shadow-sm"
                        >
                          Confirmar Entrega
                        </button>
                      )}

                      {activeTab === 'my-errands' && errand.status === 'completed' && !errand.hasBeenReviewed && (
                        <button
                          onClick={() => setReviewingErrand(errand)}
                          className="bg-yellow-500 text-white px-6 py-2 rounded-xl font-bold hover:bg-yellow-600 transition-colors shadow-sm flex items-center gap-2"
                        >
                          <Star className="w-4 h-4 fill-white" /> Valorar
                        </button>
                      )}

                      {(isAdmin || (activeTab === 'my-errands' && errand.status === 'open')) && (
                        <button
                          onClick={() => setDeletingErrandId(errand.id)}
                          className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                          title="Eliminar recado"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      )}

                      {errand.candidateId === user.uid && (
                        <div className="mt-4 p-3 bg-blue-50 rounded-xl border border-blue-100">
                          <p className="text-sm font-bold text-blue-700 flex items-center gap-2">
                            <Clock className="w-4 h-4" />
                            Has postulado a este recado
                            {errand.counterPrice && errand.counterOfferStatus === 'pending' && (
                              <span className="text-orange-600"> con una contraoferta de {errand.counterPrice}€</span>
                            )}
                          </p>
                          <p className="text-xs text-blue-600 mt-1">Esperando respuesta del dueño...</p>
                        </div>
                      )}

                      {errand.status === 'accepted' && (
                        <button
                          onClick={() => reportUser(errand.id, errand.creatorId === user.uid ? (errand.acceptedById || '') : errand.creatorId)}
                          className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                          title="Denunciar incumplimiento"
                        >
                          <AlertTriangle className="w-5 h-5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {errand.creatorId === user.uid && errand.status === 'pending' && errand.counterPrice && errand.counterOfferStatus === 'pending' && (
                    <div className="mt-4 p-4 bg-orange-50 rounded-2xl border border-orange-100 flex items-center gap-4">
                      <div className="bg-orange-100 p-2 rounded-full">
                        <HandCoins className="w-5 h-5 text-orange-600" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-bold text-orange-900">¡Tienes una contraoferta!</p>
                        <p className="text-xs text-orange-700">{errand.candidateName} propone realizar el recado por <b className="text-lg">{errand.counterPrice}€</b> en lugar de {errand.price}€.</p>
                      </div>
                    </div>
                  )}

                  {errand.status === 'accepted' && (
                    <div className="mt-4 p-3 bg-amber-50 rounded-xl flex items-center gap-3 text-sm text-amber-800 border border-amber-100">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <p>Recuerda: El pago de <b>{errand.price}€</b> se realiza en mano al finalizar.</p>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </main>

      {/* Profile Modal */}
      {selectedProfileId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full max-h-[80vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            <div className="p-8 bg-gradient-to-br from-blue-600 to-blue-700 text-white relative">
              <button 
                onClick={() => setSelectedProfileId(null)} 
                className="absolute top-4 right-4 p-2 hover:bg-white/10 rounded-full transition-colors"
              >
                <XCircle className="w-6 h-6" />
              </button>
              <div className="flex items-center gap-6">
                <div className="w-20 h-20 bg-white/20 rounded-3xl flex items-center justify-center backdrop-blur-md">
                  <UserIcon className="w-10 h-10" />
                </div>
                <div>
                  <h2 className="text-3xl font-black mb-1">
                    {errands.find(e => e.creatorId === selectedProfileId)?.creatorName || 
                     errands.find(e => e.acceptedById === selectedProfileId)?.acceptedByName || 
                     errands.find(e => e.candidateId === selectedProfileId)?.candidateName || 
                     'Usuario'}
                  </h2>
                  <div className="flex items-center gap-4 text-blue-100">
                    <div className="flex items-center gap-1">
                      <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                      <span className="font-bold">{userRatings[selectedProfileId]?.rating.toFixed(1) || '0.0'}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4" />
                      <span className="font-bold">{userRatings[selectedProfileId]?.count || 0} completados</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-8">
              <h3 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-blue-600" />
                Reseñas recibidas
              </h3>
              
              <div className="space-y-6">
                {profileReviews.length === 0 ? (
                  <div className="text-center py-12 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
                    <p className="text-gray-400 font-medium">Este usuario aún no tiene reseñas.</p>
                  </div>
                ) : (
                  profileReviews.map((review) => (
                    <div key={review.id} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex gap-1">
                          {[1, 2, 3, 4, 5].map((s) => (
                            <Star 
                              key={s} 
                              className={cn(
                                "w-3 h-3", 
                                s <= review.rating ? "fill-yellow-400 text-yellow-400" : "text-gray-200"
                              )} 
                            />
                          ))}
                        </div>
                        <span className="text-[10px] text-gray-400">
                          {review.createdAt ? formatDistanceToNow(review.createdAt.toDate(), { addSuffix: true, locale: es }) : ''}
                        </span>
                      </div>
                      <p className="text-gray-600 text-sm italic">"{review.comment}"</p>
                    </div>
                  ))
                )}
              </div>
            </div>
            
            <div className="p-6 bg-gray-50 border-t border-gray-100">
              <button 
                onClick={() => setSelectedProfileId(null)}
                className="w-full py-4 bg-white border border-gray-200 rounded-2xl font-bold text-gray-600 hover:bg-gray-100 transition-all"
              >
                Cerrar Perfil
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer / Mobile Nav */}
      <footer className="bg-white border-t border-gray-200 py-6 text-center text-gray-400 text-sm">
        <p>© 2026 RecadoYa - Ayuda mutua en tu barrio</p>
      </footer>
    </div>
  );
}
