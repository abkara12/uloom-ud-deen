import admin from "firebase-admin";

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

if (!projectId || !clientEmail || !privateKey) {
  throw new Error("Firebase environment variables are not set.");
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
}

const db = admin.firestore();

type ReportItem = {
  studentId: string;
  student: string;
  parentPhone: string;
  report: string;
  weekKey: string;
};

type LogDoc =
  FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>;

function getStartOfWeek(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatWeekKey(date = new Date()) {
  return getStartOfWeek(date).toISOString().split("T")[0];
}

function normalisePhone(phone?: string) {
  if (!phone) return "";
  let cleaned = phone.replace(/\s+/g, "").replace(/[^\d+]/g, "");

  if (cleaned.startsWith("0")) cleaned = "27" + cleaned.slice(1);
  if (cleaned.startsWith("+")) cleaned = cleaned.slice(1);

  return cleaned;
}


function sabakToLines(value: unknown) {
  const s = toText(value).toLowerCase().trim();
  if (!s) return 0;

  if (s.includes("page") || s.includes("p")) {
    const n = parseFloat(s.replace(",", "."));
    return isNaN(n) ? 0 : n * 13;
  }

  const n = parseFloat(s.replace(",", "."));
  return isNaN(n) ? 0 : n;
}

function getAverageSabakLines(logs: LogDoc[]) {
  const presentLogs = getPresentLogs(logs);

  if (!presentLogs.length) return "No sabak recorded";

  const totalLines = presentLogs.reduce((sum, doc) => {
    return sum + sabakToLines(doc.data().sabak);
  }, 0);

  return `${(totalLines / presentLogs.length).toFixed(1)} lines/day`;
}
function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toText(value: unknown) {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value.trim() : String(value).trim();
}

function toDate(value: any) {
  if (!value) return null;
  return value.toDate ? value.toDate() : new Date(value);
}

function formatShortDate(date: Date) {
  return date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
  });
}

function isAbsentDoc(doc: LogDoc) {
  return toText(doc.data().attendance).toLowerCase().includes("absent");
}

function hasAnyText(...values: unknown[]) {
  return values.some((value) => Boolean(toText(value)));
}

function getQualityScore(quality?: string) {
  const q = toText(quality).toLowerCase();

  if (q.includes("excellent")) return 4;
  if (q.includes("very good")) return 3.5;
  if (q.includes("good")) return 3;
  if (q.includes("fair")) return 2;
  if (q.includes("weak")) return 1;
  if (q.includes("poor")) return 0.5;

  return 2;
}

function hasNoQualityData(logs: LogDoc[], fields: string[]) {
  return logs
    .filter((doc) => !isAbsentDoc(doc))
    .every((doc) => {
      const data = doc.data();
      return !fields.some((field) => data[field]);
    });
}

function averageQuality(logs: LogDoc[], fields: string[]) {
  let total = 0;
  let count = 0;

  logs
    .filter((doc) => !isAbsentDoc(doc))
    .forEach((doc) => {
      const data = doc.data();

      fields.forEach((field) => {
        if (data[field]) {
          total += getQualityScore(data[field]);
          count++;
        }
      });
    });

  return count ? total / count : 0;
}

function getPresentLogs(logs: LogDoc[]) {
  return logs.filter((doc) => !isAbsentDoc(doc));
}

function getOverallWeek(logs: LogDoc[]) {
  if (!logs.length) return "No Logs Recorded";

  const presentLogs = getPresentLogs(logs);

  const avg = averageQuality(logs, [
    "sabakReadQuality",
    "sabakRead",
    "sabakDhorReadQuality",
    "sabakDhorRead",
    "dhorReadQuality",
    "dhorRead",
  ]);

  if (presentLogs.length >= 5 && avg >= 3.2) return "Outstanding ⭐";
  if (presentLogs.length >= 5 && avg >= 2.7) return "Excellent";
  if (presentLogs.length >= 4 && avg >= 2.2) return "Good";
  if (presentLogs.length >= 3) return "Building Consistency";

  return "Needs More Consistency";
}

function getSabakStrength(logs: LogDoc[]) {
  if (hasNoQualityData(logs, ["sabakReadQuality", "sabakRead"])) {
    return "No logs recorded";
  }

  const avg = averageQuality(logs, ["sabakReadQuality", "sabakRead"]);

  if (avg >= 3.2) return "Excellent";
  if (avg >= 2.7) return "Strong";
  if (avg >= 2.1) return "Good";

  return "Can Improve";
}

function getSabakDhorStrength(logs: LogDoc[]) {
  if (hasNoQualityData(logs, ["sabakDhorReadQuality", "sabakDhorRead"])) {
    return "No logs recorded";
  }

  const avg = averageQuality(logs, ["sabakDhorReadQuality", "sabakDhorRead"]);

  if (avg >= 3.2) return "Excellent";
  if (avg >= 2.7) return "Strong";
  if (avg >= 2.1) return "Good";

  return "Needs More Attention";
}
function getDhorStrength(logs: LogDoc[]) {
  if (hasNoQualityData(logs, ["dhorReadQuality", "dhorRead"])) {
    return "No logs recorded";
  }

  const avg = averageQuality(logs, ["dhorReadQuality", "dhorRead"]);

  if (avg >= 3.2) return "Excellent";
  if (avg >= 2.7) return "Strong";
  if (avg >= 2.1) return "Good";

  return "Needs More Attention";
}
function compareNumber(current: number, previous: number, label: string) {
  if (!previous && current) return `✅ ${label} started strongly`;
  if (current > previous) return `✅ ${label} improved`;
  if (current < previous) return `⚠️ ${label} needs more attention`;
  return `➖ ${label} remained steady`;
}

function getTeacherNotesFromLogs(logs: LogDoc[]) {
  return logs
    .map((doc) => toText(doc.data().generalNotes))
    .filter(Boolean)
    .slice(0, 2);
}

function getMistakeFocus(logs: LogDoc[]) {
  const hasSabakDhorMistakes = logs.some((doc) =>
    toText(doc.data().sabakDhorMistakes)
  );

  const hasDhorMistakes = logs.some((doc) => toText(doc.data().dhorMistakes));

  if (hasSabakDhorMistakes && hasDhorMistakes) {
    return "Some mistakes were noted in both sabak dhor and dhor revision, so extra listening and correction at home will be beneficial.";
  }

  if (hasDhorMistakes) {
    return "Some dhor revision mistakes were noted, so older revision should be given extra attention.";
  }

  if (hasSabakDhorMistakes) {
    return "Some sabak dhor mistakes were noted, so recent revision should be strengthened.";
  }

  return "";
}
function buildTeacherHighlight({
  attendance,
  goalCompleted,
  sabakStrength,
  sabakDhorStrength,
  dhorStrength,
  previousLogs,
  currentLogs,
}: {
  attendance: number;
  goalCompleted: boolean;
  sabakStrength: string;
  sabakDhorStrength: string;
  dhorStrength: string;
  previousLogs: LogDoc[];
  currentLogs: LogDoc[];
}) {
  const notes = currentLogs
    .map((doc) => toText(doc.data().generalNotes))
    .filter(Boolean);

  const currentSabak = averageQuality(currentLogs, [
    "sabakReadQuality",
    "sabakRead",
  ]);

  const previousSabak = averageQuality(previousLogs, [
    "sabakReadQuality",
    "sabakRead",
  ]);

  const currentSabakDhor = averageQuality(currentLogs, [
    "sabakDhorReadQuality",
    "sabakDhorRead",
  ]);

  const previousSabakDhor = averageQuality(previousLogs, [
    "sabakDhorReadQuality",
    "sabakDhorRead",
  ]);

  const currentDhor = averageQuality(currentLogs, [
    "dhorReadQuality",
    "dhorRead",
  ]);

  const previousDhor = averageQuality(previousLogs, [
    "dhorReadQuality",
    "dhorRead",
  ]);

  const highlights: string[] = [];

  if (notes.length) {
    return notes[0].length > 140
      ? notes[0].slice(0, 140).trim() + "..."
      : notes[0];
  }

  if (attendance === 5) {
    highlights.push(
      "Excellent consistency was maintained through full attendance."
    );
  }

  if (goalCompleted) {
    highlights.push(
      "The weekly target was successfully completed."
    );
  }

  if (currentSabak - previousSabak >= 0.5) {
    highlights.push(
      "A noticeable improvement was seen in new lesson preparation."
    );
  }

  if (currentSabakDhor - previousSabakDhor >= 0.5) {
    highlights.push(
      "Recent revision showed encouraging improvement."
    );
  }

  if (currentDhor - previousDhor >= 0.5) {
    highlights.push(
      "Older revision retention strengthened compared to last week."
    );
  }

  if (
    sabakStrength === "Excellent" &&
    sabakDhorStrength === "Excellent" &&
    dhorStrength === "Excellent"
  ) {
    highlights.push(
      "Strong performance was maintained across all areas of recitation."
    );
  }

  if (
    attendance === 5 &&
    !goalCompleted &&
    highlights.length < 2
  ) {
    highlights.push(
      "Commendable effort was shown throughout the week despite some remaining challenges."
    );
  }

  if (attendance <= 2) {
    highlights.push(
      "Improved attendance will significantly assist future progress."
    );
  }

  if (
    sabakStrength === "Can Improve" &&
    sabakDhorStrength === "Needs More Attention"
  ) {
    highlights.push(
      "Greater consistency in preparation and recent revision remains a priority."
    );
  }

  if (!highlights.length) {
    highlights.push(
      "Steady progress was observed throughout the week."
    );
  }

  return highlights.slice(0, 2).join(" ");
}

function buildAutoReflection({
  studentName,
  attendance,
  goalCompleted,
  sabakStrength,
  sabakDhorStrength,
  dhorStrength,
  previousLogs,
  currentLogs,
}: {
  studentName: string;
  attendance: number;
  goalCompleted: boolean;
  sabakStrength: string;
  sabakDhorStrength: string;
  dhorStrength: string;
  previousLogs: LogDoc[];
  currentLogs: LogDoc[];
}) {
  const notes = getTeacherNotesFromLogs(currentLogs);
  const mistakeFocus = getMistakeFocus(currentLogs);

  const currentSabakAvg = averageQuality(currentLogs, [
    "sabakReadQuality",
    "sabakRead",
  ]);
  const previousSabakAvg = averageQuality(previousLogs, [
    "sabakReadQuality",
    "sabakRead",
  ]);

  const currentSabakDhorAvg = averageQuality(currentLogs, [
    "sabakDhorReadQuality",
    "sabakDhorRead",
  ]);
  const previousSabakDhorAvg = averageQuality(previousLogs, [
    "sabakDhorReadQuality",
    "sabakDhorRead",
  ]);

  const currentDhorAvg = averageQuality(currentLogs, [
    "dhorReadQuality",
    "dhorRead",
  ]);
  const previousDhorAvg = averageQuality(previousLogs, [
    "dhorReadQuality",
    "dhorRead",
  ]);

  const sabakImproved =
    previousLogs.length > 0 && currentSabakAvg > previousSabakAvg;
  const sabakDhorImproved =
    previousLogs.length > 0 && currentSabakDhorAvg > previousSabakDhorAvg;
  const dhorImproved =
    previousLogs.length > 0 && currentDhorAvg > previousDhorAvg;

  let reflection = "";

  if (notes.length) {
    reflection = `Alhamdulillah, ${studentName} had helpful feedback noted during the week. ${notes.join(
      " "
    )} Please continue supporting this progress at home through encouragement and daily revision.`;
  } else if (
    attendance >= 5 &&
    goalCompleted &&
    sabakDhorStrength !== "Needs More Attention" &&
    dhorStrength !== "Needs More Attention"
  ) {
    reflection = `Alhamdulillah, ${studentName} had a strong and pleasing week. The consistency in attendance, completion of the weekly goal, sabak dhor and dhor revision show good effort and commitment.`;
  } else if (attendance <= 2) {
    reflection = `${studentName} will benefit greatly from a stronger attendance routine. With more consistent attendance, it will become easier to build momentum and make steady hifdh progress, in shaa Allah.`;
  } else if (dhorStrength === "Needs More Attention") {
    reflection = `${studentName} is making effort, but older dhor revision needs more attention. Strengthening older work through short, regular listening at home will help the memorised portions become firmer.`;
  } else if (sabakDhorStrength === "Needs More Attention") {
    reflection = `${studentName} is making effort, but sabak dhor needs more consistency. Strengthening recent revision will help the new work remain firm.`;
  } else if (sabakStrength === "Excellent" || sabakStrength === "Strong") {
    reflection = `Alhamdulillah, ${studentName} showed pleasing effort in sabak this week. If the same attention continues with sabak dhor and dhor revision, the overall hifdh routine will become much stronger.`;
  } else if (!goalCompleted) {
    reflection = `${studentName} made some progress this week, but the weekly goal was not fully completed. A little more preparation before class can help next week’s goal become easier to reach, in shaa Allah.`;
  } else {
    reflection = `Alhamdulillah, ${studentName} made steady progress this week. The main focus now is to keep building consistency so that sabak, sabak dhor and dhor revision continue improving together.`;
  }

  if (sabakImproved && sabakDhorImproved && dhorImproved) {
    reflection += ` It is also pleasing to see improvement in sabak, sabak dhor and dhor revision compared to last week.`;
  } else if (sabakImproved) {
    reflection += ` There was also a positive improvement in sabak compared to last week.`;
  } else if (sabakDhorImproved) {
    reflection += ` There was also a positive improvement in sabak dhor compared to last week.`;
  } else if (dhorImproved) {
    reflection += ` There was also a positive improvement in dhor revision compared to last week.`;
  }

  if (mistakeFocus) reflection += ` ${mistakeFocus}`;

  return reflection;
}

function buildWhatWentWell({
  attendance,
  goalCompleted,
  sabakStrength,
  sabakDhorStrength,
  dhorStrength,
}: {
  attendance: number;
  goalCompleted: boolean;
  sabakStrength: string;
  sabakDhorStrength: string;
  dhorStrength: string;
}) {
  const points: string[] = [];

  if (attendance >= 5) points.push("Full attendance was maintained.");
  else if (attendance >= 4) points.push("Attendance was good overall.");

  if (goalCompleted) points.push("The weekly goal was completed.");

  if (sabakStrength === "Excellent" || sabakStrength === "Strong") {
    points.push("Sabak was a pleasing area this week.");
  }

  if (sabakDhorStrength === "Excellent" || sabakDhorStrength === "Strong") {
    points.push("Sabak dhor showed good strength.");
  }

  if (dhorStrength === "Excellent" || dhorStrength === "Strong") {
    points.push("Dhor revision was firm this week.");
  }

  if (!points.length) {
    points.push("Effort was made, and there is room to build further next week.");
  }

  return points;
}


const attendanceFocus = [
  "Aim to attend every class to maintain momentum.",
  "Consistency in attendance should be the main focus next week.",
  "Regular attendance will greatly improve overall progress.",
  "Establishing a stronger routine will help build confidence.",
  "Making every lesson count should be a priority."
];

const goalFocus = [
  "Break the weekly target into smaller daily goals.",
  "Earlier preparation should help achieve next week's target.",
  "Focus on completing daily tasks consistently.",
  "A stronger revision schedule will support goal completion.",
  "Improving preparation outside class should help achieve targets."
];

const sabakFocus = [
  "Listen to the new lesson more frequently before class.",
  "Increase fluency before presenting the new lesson.",
  "Reduce hesitation by revising the lesson multiple times.",
  "Focus on smoother recitation during sabak.",
  "Spend extra time strengthening new lesson preparation."
];

const sabakDhorFocus = [
  "Increase revision of recently memorised portions.",
  "Dedicate additional time to sabak dhor revision.",
  "Focus on retaining newer memorisation more confidently.",
  "Review recent lessons consistently throughout the week.",
  "Strengthen recall of recently completed portions."
];

const dhorFocus = [
  "Allocate extra time to older revision.",
  "Strengthen retention of older portions through repetition.",
  "Review older surahs more consistently.",
  "Focus on maintaining long-term retention.",
  "Spend additional time on weaker older portions."
];

const excellenceFocus = [
  "Maintain the excellent standards achieved this week.",
  "Continue the strong routine that produced these results.",
  "Build on this week's momentum and consistency.",
  "Aim to sustain the quality demonstrated this week.",
  "Continue striving for excellence across all areas."
];

function randomItem(items: string[]) {
  return items[Math.floor(Math.random() * items.length)];
}
function buildFocusForNextWeek({
  attendance,
  goalCompleted,
  sabakStrength,
  sabakDhorStrength,
  dhorStrength,
}: {
  attendance: number;
  goalCompleted: boolean;
  sabakStrength: string;
  sabakDhorStrength: string;
  dhorStrength: string;
}) {
  const points: string[] = [];

  if (attendance <= 3) {
    points.push(randomItem(attendanceFocus));
  }

  if (!goalCompleted) {
    points.push(randomItem(goalFocus));
  }

  if (sabakStrength === "Can Improve") {
    points.push(randomItem(sabakFocus));
  }

  if (sabakDhorStrength === "Needs More Attention") {
    points.push(randomItem(sabakDhorFocus));
  }

  if (dhorStrength === "Needs More Attention") {
    points.push(randomItem(dhorFocus));
  }

  if (!points.length) {
    points.push(randomItem(excellenceFocus));
    points.push(randomItem(excellenceFocus));
  }

  return [...new Set(points)].slice(0, 3);
}

function buildDailyBreakdown(logDoc: LogDoc) {
  const data = logDoc.data();
  const dateObj = toDate(data.createdAt) ?? new Date();

  const dayName = dateObj.toLocaleDateString("en-US", {
    weekday: "long",
  });

  const dateFormatted = dateObj.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
  });

  if (isAbsentDoc(logDoc)) {
    return `📅 *${dayName} - ${dateFormatted}*

❌ *Absent*`;
  }

  let dayText = `📅 *${dayName} - ${dateFormatted}*`;
  let hasDetails = false;

  if (
    hasAnyText(
      data.sabak,
      data.sabakReadQuality,
      data.sabakRead,
      data.sabakReadNotes
    )
  ) {
    hasDetails = true;

    dayText += `

📖 *Sabak*
${toText(data.sabak) || "Not specified"}`;

    const quality = toText(data.sabakReadQuality) || toText(data.sabakRead);
    if (quality) dayText += ` | ${quality}`;

    if (toText(data.sabakReadNotes)) {
      dayText += `
_Note:_ ${toText(data.sabakReadNotes)}`;
    }
  }

  if (
    hasAnyText(
      data.sabakDhor,
      data.sabakDhorReadQuality,
      data.sabakDhorRead,
      data.sabakDhorReadNotes,
      data.sabakDhorMistakes
    )
  ) {
    hasDetails = true;

    dayText += `

🔁 *Sabak Dhor*
${toText(data.sabakDhor) || "Not specified"}`;

    const quality =
      toText(data.sabakDhorReadQuality) || toText(data.sabakDhorRead);
    if (quality) dayText += ` | ${quality}`;

    if (toText(data.sabakDhorReadNotes)) {
      dayText += `
_Note:_ ${toText(data.sabakDhorReadNotes)}`;
    }

    if (toText(data.sabakDhorMistakes)) {
      dayText += `

⚠️ *Sabak Dhor Mistakes*
${toText(data.sabakDhorMistakes)}`;
    }
  }

  if (
    hasAnyText(
      data.dhor,
      data.dhorReadQuality,
      data.dhorRead,
      data.dhorReadNotes,
      data.dhorMistakes
    )
  ) {
    hasDetails = true;

    dayText += `

📚 *Dhor Revision*
${toText(data.dhor) || "Not specified"}`;

    const quality = toText(data.dhorReadQuality) || toText(data.dhorRead);
    if (quality) dayText += ` | ${quality}`;

    if (toText(data.dhorReadNotes)) {
      dayText += `
_Note:_ ${toText(data.dhorReadNotes)}`;
    }

    if (toText(data.dhorMistakes)) {
      dayText += `

⚠️ *Dhor Revision Mistakes*
${toText(data.dhorMistakes)}`;
    }
  }

  if (toText(data.generalNotes)) {
    hasDetails = true;

    dayText += `

🗒️ *General Note*
${toText(data.generalNotes)}`;
  }

  if (!hasDetails) {
    dayText += `

✅ *Present*

No detailed progress was logged for this day.`;
  }

  return dayText;
}

export async function GET() {
  try {
    const usersSnapshot = await db.collection("users").get();
    const reports: ReportItem[] = [];

    const weekKey = formatWeekKey();

    const weekStart = getStartOfWeek();
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const previousWeekStart = new Date(weekStart);
    previousWeekStart.setDate(previousWeekStart.getDate() - 7);

    const weekRange = `${formatShortDate(weekStart)} - ${formatShortDate(
      weekEnd
    )}`;

    for (const userDoc of usersSnapshot.docs) {
      const userData = userDoc.data();

      const sendDocId = `${weekKey}_${userDoc.id}`;
      const alreadySentDoc = await db
        .collection("weeklyReportSends")
        .doc(sendDocId)
        .get();

      if (alreadySentDoc.exists) continue;

      const logsSnapshot = await db
        .collection("users")
        .doc(userDoc.id)
        .collection("logs")
        .orderBy("createdAt", "desc")
        .get();

      const allLogs = logsSnapshot.docs;

      const currentWeekLogs = allLogs.filter((doc) => {
        const date = toDate(doc.data().createdAt);
        return date && date >= weekStart && date <= weekEnd;
      });

      const previousWeekLogs = allLogs.filter((doc) => {
        const date = toDate(doc.data().createdAt);
        return date && date >= previousWeekStart && date < weekStart;
      });

      const sortedCurrentLogs = [...currentWeekLogs].sort((a, b) => {
        const aDate = toDate(a.data().createdAt)?.getTime() ?? 0;
        const bDate = toDate(b.data().createdAt)?.getTime() ?? 0;
        return aDate - bDate;
      });

      const studentName = userData.username ?? "Student";
      const latestLog = currentWeekLogs[0]?.data();

      const weeklyGoal = toText(latestLog?.weeklyGoal) || "-";
      const goalCompleted = !!latestLog?.weeklyGoalCompleted;
      const goalStatus = goalCompleted ? "Completed ✅" : "Still In Progress";

      const attendance = getPresentLogs(currentWeekLogs).length;
      const previousAttendance = getPresentLogs(previousWeekLogs).length;

      const overallWeek = getOverallWeek(currentWeekLogs);
      const sabakStrength = getSabakStrength(currentWeekLogs);
      const averageSabak = getAverageSabakLines(currentWeekLogs);
      const sabakDhorStrength = getSabakDhorStrength(currentWeekLogs);
      const dhorStrength = getDhorStrength(currentWeekLogs);

      const currentSabakAvg = averageQuality(currentWeekLogs, [
        "sabakReadQuality",
        "sabakRead",
      ]);
      const previousSabakAvg = averageQuality(previousWeekLogs, [
        "sabakReadQuality",
        "sabakRead",
      ]);

      const currentSabakDhorAvg = averageQuality(currentWeekLogs, [
        "sabakDhorReadQuality",
        "sabakDhorRead",
      ]);
      const previousSabakDhorAvg = averageQuality(previousWeekLogs, [
        "sabakDhorReadQuality",
        "sabakDhorRead",
      ]);

      const currentDhorAvg = averageQuality(currentWeekLogs, [
        "dhorReadQuality",
        "dhorRead",
      ]);
      const previousDhorAvg = averageQuality(previousWeekLogs, [
        "dhorReadQuality",
        "dhorRead",
      ]);

      const weeklyReflection =
        toText(latestLog?.weeklyReflection) ||
        buildAutoReflection({
          studentName,
          attendance,
          goalCompleted,
          sabakStrength,
          sabakDhorStrength,
          dhorStrength,
          previousLogs: previousWeekLogs,
          currentLogs: currentWeekLogs,
        });

      const teacherHighlight = buildTeacherHighlight({
        attendance,
        goalCompleted,
        sabakStrength,
        sabakDhorStrength,
        dhorStrength,
        previousLogs: previousWeekLogs,
        currentLogs: currentWeekLogs,
      });

      const whatWentWell = buildWhatWentWell({
        attendance,
        goalCompleted,
        sabakStrength,
        sabakDhorStrength,
        dhorStrength,
      });

      const focusForNextWeek = buildFocusForNextWeek({
        attendance,
        goalCompleted,
        sabakStrength,
        sabakDhorStrength,
        dhorStrength,
      });

      let reportText = `السلام عليكم ورحمة الله وبركاته

🌙 *Weekly Hifdh Progress Report*

*Student:* ${studentName}
*Ustad:* Moulana معاذ
*Week:* ${weekRange}

━━━━━━━━━━━━━━━━━━

🌟 *Teacher Highlight*

${teacherHighlight}

━━━━━━━━━━━━━━━━━━

🏆 *This Week At A Glance*

⭐ *Overall:* ${overallWeek}
📅 *Attendance:* ${attendance}/5 days
🎯 *Weekly Goal:* ${weeklyGoal}
✅ *Goal Status:* ${goalStatus}
📖 *Sabak:* ${sabakStrength}
📊 *Average Sabak:* ${averageSabak}
🔁 *Sabak Dhor:* ${sabakDhorStrength}
📚 *Dhor Revision:* ${dhorStrength}

━━━━━━━━━━━━━━━━━━

💬 *Teacher’s Reflection*

${weeklyReflection}

━━━━━━━━━━━━━━━━━━


🎯 *Focus For Next Week*

${focusForNextWeek.map((point) => `• ${point}`).join("\n")}

`;

      if (previousWeekLogs.length) {
        reportText += `━━━━━━━━━━━━━━━━━━

📈 *Compared To Last Week*

${compareNumber(attendance, previousAttendance, "Attendance")}
${compareNumber(currentSabakAvg, previousSabakAvg, "Sabak")}
${compareNumber(currentSabakDhorAvg, previousSabakDhorAvg, "Sabak Dhor")}
${compareNumber(currentDhorAvg, previousDhorAvg, "Dhor Revision")}

`;
      }

      if (currentWeekLogs.length > 0) {
        reportText += `━━━━━━━━━━━━━━━━━━

📚 *Daily Breakdown*

${sortedCurrentLogs.map(buildDailyBreakdown).join(`

──────────────

`)}`;
      } else {
        reportText += `━━━━━━━━━━━━━━━━━━

No logs were recorded this week.

Please ensure daily progress is logged so parents can receive meaningful weekly feedback.`;
      }

      reportText += `

━━━━━━━━━━━━━━━━━━

Every letter recited is an investment for this world and the Aakhirah. May Allah place barakah in this hifdh journey and make ${studentName} from the people of the Qur’an.

*Powered by The Hifdh Journal*`;

      reports.push({
        studentId: userDoc.id,
        student: studentName,
        parentPhone: normalisePhone(userData.parentPhone),
        report: reportText.trim(),
        weekKey,
      });
    }

    let html = `
      <html>
        <head>
          <meta charset="UTF-8" />
          <title>Weekly Hifdh Reports</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              background: #f4f6f8;
              margin: 0;
              padding: 24px;
            }
            .wrap {
              max-width: 1100px;
              margin: 0 auto;
            }
            .title {
              font-size: 28px;
              font-weight: 700;
              margin-bottom: 8px;
            }
            .subtitle {
              color: #666;
              margin-bottom: 24px;
            }
            .card {
              border: 1px solid #e5e7eb;
              padding: 20px;
              margin-bottom: 20px;
              border-radius: 14px;
              background: #fff;
              box-shadow: 0 2px 10px rgba(0,0,0,0.04);
            }
            .student {
              font-size: 22px;
              font-weight: 700;
              margin-bottom: 8px;
            }
            .phone {
              color: #666;
              margin-bottom: 12px;
            }
            pre {
              white-space: pre-wrap;
              font-family: monospace;
              background: #fafafa;
              padding: 14px;
              border-radius: 10px;
              border: 1px solid #eee;
              line-height: 1.55;
            }
            .btn-row {
              display: flex;
              gap: 10px;
              flex-wrap: wrap;
              margin-top: 14px;
            }
            button, a.btn {
              border: none;
              padding: 10px 14px;
              border-radius: 10px;
              cursor: pointer;
              text-decoration: none;
              display: inline-block;
              font-size: 14px;
              font-weight: 600;
            }
            .copy-btn {
              background: #111827;
              color: white;
            }
            .wa-btn {
              background: #25D366;
              color: white;
            }
            .disabled {
              background: #d1d5db !important;
              color: #6b7280 !important;
              cursor: not-allowed !important;
              pointer-events: none;
            }
            .empty {
              background: white;
              border-radius: 14px;
              padding: 24px;
              border: 1px solid #e5e7eb;
            }
          </style>
        </head>
        <body>
          <div class="wrap">
            <div class="title">Weekly Hifdh Reports</div>
            <div class="subtitle">Week starting: ${weekKey}</div>
    `;

    if (reports.length === 0) {
      html += `
        <div class="empty">
          All reports for this week have been handled.
        </div>
      `;
    } else {
      reports.forEach((r) => {
        const encodedMessage = encodeURIComponent(r.report);
        const whatsappUrl = r.parentPhone
          ? `https://wa.me/${r.parentPhone}?text=${encodedMessage}`
          : "";

        html += `
          <div class="card" id="card-${r.studentId}">
            <div class="student">${escapeHtml(r.student)}</div>
            <div class="phone">Parent: ${escapeHtml(
              r.parentPhone || "No parent number saved"
            )}</div>

            <pre>${escapeHtml(r.report)}</pre>

            <div class="btn-row">
              <button
                class="copy-btn"
                onclick="navigator.clipboard.writeText(${JSON.stringify(
                  r.report
                )})"
              >
                Copy Report
              </button>

              ${
                r.parentPhone
                  ? `<a
                      href="${whatsappUrl}"
                      target="_blank"
                      class="btn wa-btn"
                    >
                      Send on WhatsApp
                    </a>`
                  : `<span class="btn disabled">No parent number</span>`
              }
            </div>
          </div>
        `;
      });
    }

    html += `
          </div>
        </body>
      </html>
    `;

    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (err) {
    console.error(err);
    return new Response("Server error", { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { studentId, weekKey } = body;

    if (!studentId || !weekKey) {
      return new Response("Missing studentId or weekKey", { status: 400 });
    }

    const docId = `${weekKey}_${studentId}`;

    await db.collection("weeklyReportSends").doc(docId).set({
      studentId,
      weekKey,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return Response.json({ success: true });
  } catch (error) {
    console.error(error);
    return new Response("Failed to mark report as sent", { status: 500 });
  }
}