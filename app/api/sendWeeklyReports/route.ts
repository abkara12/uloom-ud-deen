import admin from "firebase-admin";

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

if (!projectId || !clientEmail || !privateKey) {
  throw new Error("Firebase environment variables are not set.");
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  });
}

const db = admin.firestore();
// ...your imports and Firebase setup stay the same

export async function GET() {
  try {
    const usersSnapshot = await db.collection("users").get();
    const reports: { student: string; report: string }[] = [];

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    for (const userDoc of usersSnapshot.docs) {
      const userData = userDoc.data();

      const logsSnapshot = await db
        .collection("users")
        .doc(userDoc.id)
        .collection("logs")
        .orderBy("createdAt", "desc")
        .get();

      const recentLogs = logsSnapshot.docs.filter((logDoc) => {
        const logData = logDoc.data();
        const createdAt = logData.createdAt;
        if (!createdAt) return false;
        const logDate = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
        return logDate >= sevenDaysAgo;
      });

      let monthLabel = "";
      if (recentLogs.length > 0) {
        const firstLog = recentLogs[0].data();
        const d = firstLog.createdAt?.toDate ? firstLog.createdAt.toDate() : new Date();
        monthLabel = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      }

      let reportText = `السلام عليكم ورحمة الله وبركاته

📖 Weekly Hifdh Report
Student: ${userData.username}
Ustad: Moulana Shaheed Bhabha
Month: ${monthLabel}

`;

      if (recentLogs.length > 0) {
        recentLogs.forEach((logDoc, index) => {
          const logData = logDoc.data();
          const dateObj = logData.createdAt?.toDate ? logData.createdAt.toDate() : new Date();
          const dayName = dateObj.toLocaleDateString("en-US", { weekday: "short" });
          const dateFormatted = dateObj.toLocaleDateString("en-US", { day: "numeric", month: "short" });

          reportText += `${dayName} ${dateFormatted}

Sabak: ${logData.sabak ?? "-"} | ${logData.sabakReadQuality ?? "-"}${logData.sabakReadNotes ? "\nNote: " + logData.sabakReadNotes : ""}

Sabak Dhor: ${logData.sabakDhor ?? "-"} | ${logData.sabakDhorReadQuality ?? "-"}${logData.sabakDhorReadNotes ? "\nNote: " + logData.sabakDhorReadNotes : ""}

Dhor: ${logData.dhor ?? "-"} | ${logData.dhorReadQuality ?? "-"}${logData.dhorReadNotes ? "\nNote: " + logData.dhorReadNotes : ""}

Mistakes: Sabak Dhor ${logData.sabakDhorMistakes ?? "0"} | Dhor ${logData.dhorMistakes ?? "0"}

${index !== recentLogs.length - 1 ? "────────────────\n\n" : ""}
`;
        });

        const latestLog = recentLogs[0].data();
        const goalStatus = latestLog.weeklyGoalCompleted ? "Completed" : "In Progress";

        reportText += `🎯 Weekly Goal: ${latestLog.weeklyGoal ?? "-"}
📊 Goal Status: ${goalStatus}
Duration: ${latestLog.weeklyGoalDurationDays ?? "-"}

────────────────
Powered by The Hifdh Journal`;
      } else {
        reportText += `No logs recorded for the last 7 days.

────────────────
Powered by The Hifdh Journal`;
      }

      reports.push({ student: userData.username, report: reportText });
    }

    const html = `
<html>
<head>
<meta charset="UTF-8">
<title>Weekly Hifdh Reports</title>
<style>
body { font-family: monospace; background: #f9f9f9; padding: 20px; }
.report-box { background: #fff; border: 1px solid #ddd; padding: 15px; margin-bottom: 20px; border-radius: 8px; }
button { margin-top: 10px; padding: 5px 10px; cursor: pointer; }
pre { white-space: pre-wrap; word-wrap: break-word; }
</style>
</head>
<body>
<h1>Weekly Hifdh Reports</h1>
${reports
  .map(
    (r, idx) => `
<div class="report-box">
<h2>${r.student}</h2>
<pre id="report-${idx}">${r.report}</pre>
<button onclick="copyReport(${idx})">Copy to Clipboard</button>
</div>`
  )
  .join("")}

<script>
function copyReport(idx) {
  const text = document.getElementById('report-' + idx).innerText;
  navigator.clipboard.writeText(text).then(() => {
    alert('Report copied for student #' + (idx + 1));
  });
}
</script>
</body>
</html>
`;

    return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=UTF-8" } });
  } catch (err) {
    console.error(err);
    return new Response(`<html><body>Server error</body></html>`, {
      status: 500,
      headers: { "Content-Type": "text/html" },
    });
  }
}