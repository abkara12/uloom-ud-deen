/* app/admin/student/[uid]/page.tsx */
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "../../../lib/firebase";

/** -------------------- Date helpers -------------------- */
function getDateKeySA() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "00";
  const d = parts.find((p) => p.type === "day")?.value ?? "00";
  return `${y}-${m}-${d}`;
}

function parseDateKey(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map((x) => Number(x));
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function diffDaysInclusive(startKey: string, endKey: string) {
  const a = parseDateKey(startKey);
  const b = parseDateKey(endKey);
  const ms = b.getTime() - a.getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  return Math.max(0, days) + 1;
}

function isoWeekKeyFromDateKey(dateKey: string) {
  const d = parseDateKey(dateKey);
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (date.getDay() + 6) % 7; // Mon=0..Sun=6
  date.setDate(date.getDate() - day + 3); // Thu of current week
  const firstThursday = new Date(date.getFullYear(), 0, 4);
  const firstDay = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDay + 3);

  const weekNo =
    1 +
    Math.round(
      (date.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000)
    );

  const year = date.getFullYear();
  const ww = String(weekNo).padStart(2, "0");
  return `${year}-W${ww}`;
}

function toText(v: unknown) {
  if (v === null || v === undefined) return "";
  return typeof v === "string" ? v : String(v);
}

function pickText(primary: unknown, fallback: unknown) {
  const p = toText(primary).trim();
  if (p) return p;
  return toText(fallback);
}

/** -------------------- UI shell -------------------- */
function Shell({
  title,
  subtitle,
  rightSlot,
  children,
}: {
  title: string;
  subtitle?: string;
  rightSlot?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen text-gray-900">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[#F8F6F1]" />
        <div className="absolute -top-72 -right-40 h-[900px] w-[900px] rounded-full bg-[#1F3F3F]/25 blur-3xl" />
        <div className="absolute bottom-[-25%] left-[-15%] h-[1000px] w-[1000px] rounded-full bg-[#B8963D]/20 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(1000px_circle_at_70%_20%,rgba(184,150,61,0.15),transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(900px_circle_at_50%_10%,transparent_50%,rgba(0,0,0,0.08))]" />
        <div className="absolute inset-0 opacity-[0.035] mix-blend-multiply bg-[url('/noise.png')]" />
      </div>

      <div className="max-w-5xl mx-auto px-5 sm:px-10 py-8 sm:py-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <p className="uppercase tracking-widest text-xs text-[#B8963D]">
              Admin → Student
            </p>
            <h1 className="mt-2 text-2xl sm:text-4xl font-semibold tracking-tight break-words">
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-2 text-gray-700 leading-relaxed max-w-2xl">
                {subtitle}
              </p>
            ) : null}
          </div>

          {rightSlot ? <div className="w-full sm:w-auto">{rightSlot}</div> : null}
        </div>

        <div className="mt-7 sm:mt-8">{children}</div>
      </div>
    </main>
  );
}

function LoadingCard() {
  return (
    <div className="rounded-3xl border border-gray-300 bg-white/70 backdrop-blur-xl p-6 sm:p-7 shadow-sm">
      <div className="h-5 w-40 bg-black/10 rounded-full animate-pulse" />
      <div className="mt-3 h-10 w-2/3 bg-black/10 rounded-2xl animate-pulse" />
      <div className="mt-6 grid gap-3">
        <div className="h-12 bg-black/10 rounded-2xl animate-pulse" />
        <div className="h-12 bg-black/10 rounded-2xl animate-pulse" />
        <div className="h-12 bg-black/10 rounded-2xl animate-pulse" />
      </div>
    </div>
  );
}

/** -------------------- Reading quality options -------------------- */
const READING_OPTIONS = [
  { value: "", label: "Select…" },
  { value: "Excellent", label: "Excellent" },
  { value: "Good", label: "Good" },
  { value: "Average", label: "Average" },
  { value: "Poor", label: "Poor" },
];

/** -------------------- Page -------------------- */
export default function AdminStudentPage() {
  const params = useParams<{ uid: string }>();
  const studentUid = params.uid;

  const [attendance, setAttendance] = useState<"present" | "absent">("present");

  const [me, setMe] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const [studentName, setStudentName] = useState("");

  const [sabak, setSabak] = useState("");
  const [sabakDhor, setSabakDhor] = useState("");
  const [dhor, setDhor] = useState("");

  const [sabakReadQuality, setSabakReadQuality] = useState("");
  const [sabakReadNotes, setSabakReadNotes] = useState("");

  const [sabakDhorReadQuality, setSabakDhorReadQuality] = useState("");
  const [sabakDhorReadNotes, setSabakDhorReadNotes] = useState("");

  const [dhorReadQuality, setDhorReadQuality] = useState("");
  const [dhorReadNotes, setDhorReadNotes] = useState("");

  const [sabakDhorMistakes, setSabakDhorMistakes] = useState("");
  const [dhorMistakes, setDhorMistakes] = useState("");

  const [weeklyGoal, setWeeklyGoal] = useState("");
  const [weeklyGoalWeekKey, setWeeklyGoalWeekKey] = useState("");
  const [weeklyGoalStartDateKey, setWeeklyGoalStartDateKey] = useState("");
  const [weeklyGoalCompletedDateKey, setWeeklyGoalCompletedDateKey] = useState("");
  const [weeklyGoalDurationDays, setWeeklyGoalDurationDays] = useState<number | null>(null);

  const [markGoalCompleted, setMarkGoalCompleted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const dateKey = useMemo(() => getDateKeySA(), []);
  const currentWeekKey = useMemo(() => isoWeekKeyFromDateKey(dateKey), [dateKey]);

  const goalLocked =
    weeklyGoal.trim().length > 0 &&
    weeklyGoalWeekKey === currentWeekKey &&
    !weeklyGoalCompletedDateKey;

  const goalAlreadyCompleted =
    Boolean(weeklyGoalCompletedDateKey) || (weeklyGoalDurationDays ?? 0) > 0;

  const goalNotReached =
    weeklyGoal &&
    weeklyGoalStartDateKey &&
    !weeklyGoalCompletedDateKey &&
    diffDaysInclusive(weeklyGoalStartDateKey, dateKey) > 7;

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setMe(u);

      if (!u) {
        setIsAdmin(false);
        setChecking(false);
        return;
      }

      try {
        const myDoc = await getDoc(doc(db, "users", u.uid));
        const role = myDoc.exists() ? (myDoc.data() as any).role : null;
        setIsAdmin(role === "admin");
      } finally {
        setChecking(false);
      }
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    async function loadStudent() {
      if (!studentUid) return;

      setMarkGoalCompleted(false);
      setMsg(null);

      const userRef = doc(db, "users", studentUid);
      const logRef = doc(db, "users", studentUid, "logs", dateKey);

      const [sDoc, logDoc] = await Promise.all([getDoc(userRef), getDoc(logRef)]);

      if (sDoc.exists()) {
        const data = sDoc.data() as any;

        const name =
          typeof data.username === "string"
            ? data.username
            : typeof data.email === "string"
            ? data.email
            : "Student";

        setStudentName(name);
        setWeeklyGoal(toText(data.weeklyGoal));
        setWeeklyGoalWeekKey(toText(data.weeklyGoalWeekKey));
        setWeeklyGoalStartDateKey(toText(data.weeklyGoalStartDateKey));
        setWeeklyGoalCompletedDateKey(toText(data.weeklyGoalCompletedDateKey));

        const dur = data.weeklyGoalDurationDays;
        setWeeklyGoalDurationDays(
          typeof dur === "number" ? dur : dur ? Number(dur) : null
        );

        setSabak(toText(data.currentSabak));
        setSabakDhor(toText(data.currentSabakDhor));
        setDhor(toText(data.currentDhor));

        setSabakReadQuality(
          pickText(data.currentSabakRead, data.currentSabakReadQuality)
        );
        setSabakReadNotes(toText(data.currentSabakReadNotes));

        setSabakDhorReadQuality(
          pickText(data.currentSabakDhorRead, data.currentSabakDhorReadQuality)
        );
        setSabakDhorReadNotes(toText(data.currentSabakDhorReadNotes));

        setDhorReadQuality(
          pickText(data.currentDhorRead, data.currentDhorReadQuality)
        );
        setDhorReadNotes(toText(data.currentDhorReadNotes));

        setSabakDhorMistakes(toText(data.currentSabakDhorMistakes));
        setDhorMistakes(toText(data.currentDhorMistakes));
      }

      if (logDoc.exists()) {
        const log = logDoc.data() as any;

        setAttendance(log.attendance === "absent" ? "absent" : "present");

        setSabak(toText(log.sabak));
        setSabakDhor(toText(log.sabakDhor));
        setDhor(toText(log.dhor));

        setSabakReadQuality(pickText(log.sabakRead, log.sabakReadQuality));
        setSabakReadNotes(toText(log.sabakReadNotes));

        setSabakDhorReadQuality(
          pickText(log.sabakDhorRead, log.sabakDhorReadQuality)
        );
        setSabakDhorReadNotes(toText(log.sabakDhorReadNotes));

        setDhorReadQuality(pickText(log.dhorRead, log.dhorReadQuality));
        setDhorReadNotes(toText(log.dhorReadNotes));

        setSabakDhorMistakes(toText(log.sabakDhorMistakes));
        setDhorMistakes(toText(log.dhorMistakes));
      }
    }

    loadStudent();
  }, [studentUid, dateKey]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!isAdmin) return;

    setSaving(true);
    setMsg(null);

    try {
      const userRef = doc(db, "users", studentUid);
      const logRef = doc(db, "users", studentUid, "logs", dateKey);

      const [existingUserSnap, existingLogSnap] = await Promise.all([
        getDoc(userRef),
        getDoc(logRef),
      ]);

      const existingUser = existingUserSnap.exists()
        ? (existingUserSnap.data() as any)
        : {};

      const existingLog = existingLogSnap.exists()
        ? (existingLogSnap.data() as any)
        : {};

      const finalAttendance = attendance || existingLog.attendance || "present";

      const finalSabak =
        sabak.trim() !== ""
          ? sabak
          : toText(existingLog.sabak || existingUser.currentSabak);

      const finalSabakDhor =
        sabakDhor.trim() !== ""
          ? sabakDhor
          : toText(existingLog.sabakDhor || existingUser.currentSabakDhor);

      const finalDhor =
        dhor.trim() !== ""
          ? dhor
          : toText(existingLog.dhor || existingUser.currentDhor);

      const finalSabakReadQuality =
        sabakReadQuality.trim() !== ""
          ? sabakReadQuality
          : pickText(
              existingLog.sabakRead,
              existingLog.sabakReadQuality ||
                existingUser.currentSabakRead ||
                existingUser.currentSabakReadQuality
            );

      const finalSabakReadNotes =
        sabakReadNotes.trim() !== ""
          ? sabakReadNotes
          : toText(
              existingLog.sabakReadNotes || existingUser.currentSabakReadNotes
            );

      const finalSabakDhorReadQuality =
        sabakDhorReadQuality.trim() !== ""
          ? sabakDhorReadQuality
          : pickText(
              existingLog.sabakDhorRead,
              existingLog.sabakDhorReadQuality ||
                existingUser.currentSabakDhorRead ||
                existingUser.currentSabakDhorReadQuality
            );

      const finalSabakDhorReadNotes =
        sabakDhorReadNotes.trim() !== ""
          ? sabakDhorReadNotes
          : toText(
              existingLog.sabakDhorReadNotes ||
                existingUser.currentSabakDhorReadNotes
            );

      const finalDhorReadQuality =
        dhorReadQuality.trim() !== ""
          ? dhorReadQuality
          : pickText(
              existingLog.dhorRead,
              existingLog.dhorReadQuality ||
                existingUser.currentDhorRead ||
                existingUser.currentDhorReadQuality
            );

      const finalDhorReadNotes =
        dhorReadNotes.trim() !== ""
          ? dhorReadNotes
          : toText(existingLog.dhorReadNotes || existingUser.currentDhorReadNotes);

      const finalSabakDhorMistakes =
        sabakDhorMistakes.trim() !== ""
          ? sabakDhorMistakes
          : toText(
              existingLog.sabakDhorMistakes ||
                existingUser.currentSabakDhorMistakes
            );

      const finalDhorMistakes =
        dhorMistakes.trim() !== ""
          ? dhorMistakes
          : toText(existingLog.dhorMistakes || existingUser.currentDhorMistakes);

      const isDayComplete =
        finalSabak.trim() !== "" &&
        finalSabakDhor.trim() !== "" &&
        finalDhor.trim() !== "";

      let nextGoal = weeklyGoal.trim();
      let nextWeekKey = weeklyGoalWeekKey;
      let nextStartKey = weeklyGoalStartDateKey;
      let nextCompletedKey = weeklyGoalCompletedDateKey;
      let nextDuration: number | null = weeklyGoalDurationDays ?? null;

      if (nextGoal) {
        if (!nextStartKey) {
          nextStartKey = dateKey;
          nextWeekKey = currentWeekKey;
        }

        if (markGoalCompleted && !nextCompletedKey) {
          nextCompletedKey = dateKey;
          nextDuration = diffDaysInclusive(nextStartKey, dateKey);
        }

        if (nextCompletedKey && weeklyGoal.trim() !== "" && !markGoalCompleted) {
          nextStartKey = dateKey;
          nextCompletedKey = "";
          nextDuration = null;
          nextWeekKey = currentWeekKey;
        }
      }

      await setDoc(
        logRef,
        {
          dateKey,
          createdAt: existingLog.createdAt ?? serverTimestamp(),

          attendance: finalAttendance,

          sabak: finalSabak,
          sabakDhor: finalSabakDhor,
          dhor: finalDhor,

          sabakRead: finalSabakReadQuality,
          sabakDhorRead: finalSabakDhorReadQuality,
          dhorRead: finalDhorReadQuality,

          sabakReadQuality: finalSabakReadQuality,
          sabakDhorReadQuality: finalSabakDhorReadQuality,
          dhorReadQuality: finalDhorReadQuality,

          sabakReadNotes: finalSabakReadNotes,
          sabakDhorReadNotes: finalSabakDhorReadNotes,
          dhorReadNotes: finalDhorReadNotes,

          sabakDhorMistakes: finalSabakDhorMistakes,
          dhorMistakes: finalDhorMistakes,

          weeklyGoal: nextGoal,
          weeklyGoalWeekKey: nextWeekKey || null,
          weeklyGoalStartDateKey: nextStartKey || null,
          weeklyGoalCompletedDateKey: nextCompletedKey || null,
          weeklyGoalDurationDays: nextDuration,
          weeklyGoalCompleted: Boolean(nextCompletedKey),

          updatedBy: me?.uid ?? null,
          updatedByEmail: me?.email ?? null,
        },
        { merge: true }
      );

      await setDoc(
        userRef,
        {
          weeklyGoal: nextGoal,
          weeklyGoalWeekKey: nextWeekKey || null,
          weeklyGoalStartDateKey: nextStartKey || null,
          weeklyGoalCompletedDateKey: nextCompletedKey || null,
          weeklyGoalDurationDays: nextDuration,

          currentSabak: isDayComplete ? "" : finalSabak,
          currentSabakDhor: isDayComplete ? "" : finalSabakDhor,
          currentDhor: isDayComplete ? "" : finalDhor,

          currentSabakRead: isDayComplete ? "" : finalSabakReadQuality,
          currentSabakDhorRead: isDayComplete ? "" : finalSabakDhorReadQuality,
          currentDhorRead: isDayComplete ? "" : finalDhorReadQuality,

          currentSabakReadQuality: isDayComplete ? "" : finalSabakReadQuality,
          currentSabakDhorReadQuality: isDayComplete ? "" : finalSabakDhorReadQuality,
          currentDhorReadQuality: isDayComplete ? "" : finalDhorReadQuality,

          currentSabakReadNotes: isDayComplete ? "" : finalSabakReadNotes,
          currentSabakDhorReadNotes: isDayComplete ? "" : finalSabakDhorReadNotes,
          currentDhorReadNotes: isDayComplete ? "" : finalDhorReadNotes,

          currentSabakDhorMistakes: isDayComplete ? "" : finalSabakDhorMistakes,
          currentDhorMistakes: isDayComplete ? "" : finalDhorMistakes,

          updatedAt: serverTimestamp(),
          lastUpdatedBy: me?.uid ?? null,
        },
        { merge: true }
      );

      setAttendance(finalAttendance);
      setSabak(finalSabak);
      setSabakDhor(finalSabakDhor);
      setDhor(finalDhor);

      setSabakReadQuality(finalSabakReadQuality);
      setSabakReadNotes(finalSabakReadNotes);

      setSabakDhorReadQuality(finalSabakDhorReadQuality);
      setSabakDhorReadNotes(finalSabakDhorReadNotes);

      setDhorReadQuality(finalDhorReadQuality);
      setDhorReadNotes(finalDhorReadNotes);

      setSabakDhorMistakes(finalSabakDhorMistakes);
      setDhorMistakes(finalDhorMistakes);

      setWeeklyGoal(nextGoal);
      setWeeklyGoalWeekKey(nextWeekKey || "");
      setWeeklyGoalStartDateKey(nextStartKey || "");
      setWeeklyGoalCompletedDateKey(nextCompletedKey || "");
      setWeeklyGoalDurationDays(nextDuration);

      setMsg(isDayComplete ? "Saved ✅ Day completed — next day will start fresh" : "Saved ✅");
      setTimeout(() => setMsg(null), 2500);

      setMarkGoalCompleted(false);
    } catch (err: any) {
      setMsg(err?.message ? `Error: ${err.message}` : "Error saving.");
    } finally {
      setSaving(false);
    }
  }

  if (checking) {
    return (
      <Shell title="Loading…" subtitle="Opening student page…">
        <LoadingCard />
      </Shell>
    );
  }

  if (!me) {
    return (
      <Shell title="Please sign in" subtitle="You must be signed in to log work for a student.">
        <div className="rounded-3xl border border-gray-300 bg-white/70 backdrop-blur p-6 sm:p-7 shadow-sm">
          <p className="text-gray-700">Go to login, then return to the admin dashboard.</p>
          <div className="mt-5 flex flex-col sm:flex-row gap-3">
            <Link
              href="/login"
              className="inline-flex items-center justify-center h-11 px-6 rounded-full bg-black text-white text-sm font-semibold hover:bg-gray-900"
            >
              Go to login
            </Link>
            <Link
              href="/admin"
              className="inline-flex items-center justify-center h-11 px-6 rounded-full border border-gray-300 bg-white/70 hover:bg-white text-sm font-semibold"
            >
              Back to Admin
            </Link>
          </div>
        </div>
      </Shell>
    );
  }

  if (!isAdmin) {
    return (
      <Shell title="Access denied" subtitle="This account is not marked as admin.">
        <div className="rounded-3xl border border-gray-300 bg-white/70 backdrop-blur p-6 sm:p-7 shadow-sm">
          <div className="text-sm text-gray-600">Signed in as</div>
          <div className="mt-1 font-semibold">{me.email}</div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell
      title={`Log work for ${studentName || "student"}`}
      subtitle={`Submitting for ${dateKey} • ${currentWeekKey}`}
      rightSlot={
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <Link
            href="/admin"
            className="inline-flex w-full sm:w-auto items-center justify-center h-11 px-5 rounded-full border border-gray-300 bg-white/70 hover:bg-white transition-colors text-sm font-semibold"
          >
            Back
          </Link>
          <Link
            href={`/admin/student/${studentUid}/overview`}
            className="inline-flex w-full sm:w-auto items-center justify-center h-11 px-5 rounded-full bg-[#111111] text-white hover:bg-[#1c1c1c] shadow-lg shadow-black/10 transition-colors text-sm font-semibold shadow-sm"
          >
            Student Overview
          </Link>
        </div>
      }
    >
      <div className="rounded-3xl border border-gray-300 bg-white/70 backdrop-blur p-5 sm:p-8 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-gray-300 bg-white/70 px-4 py-2 text-xs font-semibold text-gray-700 w-fit">
            <span className="h-2 w-2 rounded-full bg-[#B8963D]" />
            Update today’s work
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {goalAlreadyCompleted ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                Completed in {weeklyGoalDurationDays ?? "—"} day(s)
              </span>
            ) : goalNotReached ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700">
                Not reached
              </span>
            ) : weeklyGoal ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700">
                In progress
              </span>
            ) : null}
          </div>
        </div>

        <form onSubmit={handleSave} className="mt-6 grid gap-5">
          <div className="rounded-3xl border border-gray-300 bg-white/70 backdrop-blur-xl p-5 sm:p-6">
            <div className="text-sm font-semibold text-gray-900">Attendance</div>

            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => setAttendance("present")}
                className={`px-4 py-2 rounded-xl border ${
                  attendance === "present"
                    ? "bg-emerald-100 border-emerald-400 text-emerald-700"
                    : "bg-white border-gray-300"
                }`}
              >
                Present
              </button>

              <button
                type="button"
                onClick={() => setAttendance("absent")}
                className={`px-4 py-2 rounded-xl border ${
                  attendance === "absent"
                    ? "bg-red-100 border-red-400 text-red-700"
                    : "bg-white border-gray-300"
                }`}
              >
                Absent
              </button>
            </div>
          </div>

          <div className="rounded-3xl border border-gray-300 bg-white/70 backdrop-blur-xl p-5 sm:p-6">
            <div className="text-sm font-semibold text-gray-900">Sabak</div>
            <div className="mt-4 grid gap-4">
              <Field
                label="Sabak amount"
                value={sabak}
                setValue={setSabak}
                hint="Example: 2 pages / 1 ruku / 5 lines"
              />

              <div className="grid sm:grid-cols-2 gap-4">
                <SelectField
                  label="How did the student read Sabak?"
                  value={sabakReadQuality}
                  setValue={setSabakReadQuality}
                  options={READING_OPTIONS}
                />
                <Field
                  label="Sabak reading notes (optional)"
                  value={sabakReadNotes}
                  setValue={setSabakReadNotes}
                  hint="Short notes: fluency, tajweed, stops, etc."
                />
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-gray-300 bg-white/70 backdrop-blur-xl p-5 sm:p-6">
            <div className="text-sm font-semibold text-gray-900">Sabak Dhor</div>
            <div className="mt-4 grid gap-4">
              <Field
                label="Sabak Dhor amount"
                value={sabakDhor}
                setValue={setSabakDhor}
                hint="Revision for current sabak"
              />

              <div className="grid sm:grid-cols-2 gap-4">
                <SelectField
                  label="How did the student read Sabak Dhor?"
                  value={sabakDhorReadQuality}
                  setValue={setSabakDhorReadQuality}
                  options={READING_OPTIONS}
                />
                <Field
                  label="Sabak Dhor reading notes (optional)"
                  value={sabakDhorReadNotes}
                  setValue={setSabakDhorReadNotes}
                  hint="Short notes"
                />
              </div>

              <Field
                label="Sabak Dhor mistakes"
                value={sabakDhorMistakes}
                setValue={setSabakDhorMistakes}
                hint="Number"
              />
            </div>
          </div>

          <div className="rounded-3xl border border-gray-300 bg-white/70 backdrop-blur-xl p-5 sm:p-6">
            <div className="text-sm font-semibold text-gray-900">Dhor</div>
            <div className="mt-4 grid gap-4">
              <Field
                label="Dhor amount"
                value={dhor}
                setValue={setDhor}
                hint="Older revision"
              />

              <div className="grid sm:grid-cols-2 gap-4">
                <SelectField
                  label="How did the student read Dhor?"
                  value={dhorReadQuality}
                  setValue={setDhorReadQuality}
                  options={READING_OPTIONS}
                />
                <Field
                  label="Dhor reading notes (optional)"
                  value={dhorReadNotes}
                  setValue={setDhorReadNotes}
                  hint="Short notes"
                />
              </div>

              <Field
                label="Dhor mistakes"
                value={dhorMistakes}
                setValue={setDhorMistakes}
                hint="Number"
              />
            </div>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white/70 p-5 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[#5B726D]">Weekly Goal</div>
                <div className="mt-1 text-sm text-gray-700">
                  Set once per week. When finished, tick “Completed” to calculate duration.
                </div>
              </div>

              <div className="text-xs text-gray-600">
                Week: <span className="font-semibold">{currentWeekKey}</span>
              </div>
            </div>

            <div className="mt-4 grid gap-4">
              <label className="grid gap-2">
                <div className="flex items-end justify-between gap-4">
                  <span className="text-sm font-semibold text-gray-900">Weekly Sabak Goal</span>
                  <span className="text-xs text-gray-500">
                    {goalLocked ? "Locked until completed" : "Set a new goal"}
                  </span>
                </div>

                <input
                  value={weeklyGoal}
                  onChange={(e) => setWeeklyGoal(e.target.value)}
                  disabled={goalLocked}
                  className="h-12 rounded-2xl border border-gray-200 bg-white/80 px-4 outline-none focus:ring-2 focus:ring-[#A46B72]/30 disabled:opacity-60"
                  placeholder="Example: 10 pages"
                />
                <p className="text-xs text-gray-500 mt-1">
                  After typing a new goal, press <span className="font-semibold">Enter</span> or click Save to activate it.
                </p>
              </label>

              <div className="grid gap-2 sm:grid-cols-3">
                <MiniInfo label="Started" value={weeklyGoalStartDateKey || "—"} />
                <MiniInfo label="Completed" value={weeklyGoalCompletedDateKey || "—"} />
                <MiniInfo
                  label="Duration"
                  value={weeklyGoalDurationDays ? `${weeklyGoalDurationDays} day(s)` : "—"}
                />
              </div>

              <label className="flex items-center justify-between gap-4 rounded-2xl border border-gray-300 bg-white/70 px-4 py-4">
                <div>
                  <div className="text-sm font-semibold text-gray-900">Weekly Goal Completed</div>
                  <div className="mt-1 text-xs text-gray-600">
                    Tick only when the student has finished their weekly goal.
                  </div>
                </div>

                <input
                  type="checkbox"
                  checked={goalAlreadyCompleted ? true : markGoalCompleted}
                  disabled={!weeklyGoal.trim() || goalAlreadyCompleted}
                  onChange={(e) => setMarkGoalCompleted(e.target.checked)}
                  className="h-6 w-6 accent-black disabled:opacity-50"
                />
              </label>
            </div>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <button
              disabled={saving}
              className="h-12 w-full sm:w-auto px-7 rounded-2xl bg-black text-white font-semibold hover:bg-gray-900 disabled:opacity-60 shadow-sm"
            >
              {saving ? "Saving..." : "Save"}
            </button>

            <div
              className={`text-sm font-medium ${
                msg?.startsWith("Error") ? "text-red-600" : "text-gray-700"
              }`}
            >
              {msg ?? ""}
            </div>
          </div>
        </form>
      </div>
    </Shell>
  );
}

function Field({
  label,
  hint,
  value,
  setValue,
}: {
  label: string;
  hint: string;
  value: string;
  setValue: (v: string) => void;
}) {
  return (
    <label className="grid gap-2">
      <div className="flex items-end justify-between gap-4">
        <span className="text-sm font-semibold text-gray-900">{label}</span>
        <span className="text-xs text-gray-500">{hint}</span>
      </div>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-12 rounded-2xl border border-gray-300 bg-white/80 px-4 outline-none focus:ring-2 focus:ring-[#B8963D]/30"
        placeholder="Type here…"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  setValue,
  options,
}: {
  label: string;
  value: string;
  setValue: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="grid gap-2">
      <div className="flex items-end justify-between gap-4">
        <span className="text-sm font-semibold text-gray-900">{label}</span>
        <span className="text-xs text-gray-500">Select</span>
      </div>
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-12 rounded-2xl border border-gray-300 bg-white/80 px-4 outline-none focus:ring-2 focus:ring-[#B8963D]/30"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function MiniInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-gray-300 bg-white/70 px-4 py-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-gray-900 break-words">{value}</div>
    </div>
  );
}