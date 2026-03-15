// app/lib/saveStudentLog.ts
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";

export async function saveStudentLog(studentUid: string, meUid: string, meEmail: string, dateKey: string, logData: any) {
  // Prepare weekly goal fields
  const {
    weeklyGoal,
    weeklyGoalWeekKey,
    weeklyGoalStartDateKey,
    weeklyGoalCompletedDateKey,
    weeklyGoalDurationDays,
    markGoalCompleted
  } = logData;

  let nextWeekKey = weeklyGoalWeekKey;
  let nextStartKey = weeklyGoalStartDateKey;
  let nextCompletedKey = weeklyGoalCompletedDateKey;
  let nextDuration = weeklyGoalDurationDays;

  if (weeklyGoal) {
    const isNewWeekGoal = !nextWeekKey || nextWeekKey !== logData.currentWeekKey;
    if (isNewWeekGoal) {
      nextWeekKey = logData.currentWeekKey;
      nextStartKey = dateKey;
      nextCompletedKey = "";
      nextDuration = null;
    }

    if (markGoalCompleted && !nextCompletedKey) {
      const startKey = nextStartKey || dateKey;
      nextCompletedKey = dateKey;
      nextDuration = logData.diffDaysInclusive(startKey, dateKey);
    }
  }

  // 1️⃣ Save to logs/{dateKey}
  await setDoc(
    doc(db, "users", studentUid, "logs", dateKey),
    {
      ...logData, // All your sabak/dhor fields
      weeklyGoal,
      weeklyGoalWeekKey: nextWeekKey || null,
      weeklyGoalStartDateKey: nextStartKey || null,
      weeklyGoalCompletedDateKey: nextCompletedKey || null,
      weeklyGoalDurationDays: nextDuration ?? null,
      weeklyGoalCompleted: Boolean(nextCompletedKey),

      updatedBy: meUid,
      updatedByEmail: meEmail,
      dateKey,
      createdAt: serverTimestamp()
    },
    { merge: true }
  );

  // 2️⃣ Update snapshot in users/{uid} (only weekly goal)
  await setDoc(
    doc(db, "users", studentUid),
    {
      weeklyGoal,
      weeklyGoalWeekKey: nextWeekKey || null,
      weeklyGoalStartDateKey: nextStartKey || null,
      weeklyGoalCompletedDateKey: nextCompletedKey || null,
      weeklyGoalDurationDays: nextDuration ?? null,
      updatedAt: serverTimestamp(),
      lastUpdatedBy: meUid
    },
    { merge: true }
  );

  return { nextWeekKey, nextStartKey, nextCompletedKey, nextDuration };
}