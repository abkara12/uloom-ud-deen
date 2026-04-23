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

function getStartOfWeek(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sun, 1 = Mon
  const diff = day === 0 ? -6 : 1 - day; // Monday start
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatWeekKey(date = new Date()) {
  const start = getStartOfWeek(date);
  return start.toISOString().split("T")[0]; // e.g. 2026-04-20
}

function normalisePhone(phone?: string) {
  if (!phone) return "";

  let cleaned = phone.replace(/\s+/g, "").replace(/[^\d+]/g, "");

  // If starts with 0, convert SA local to international
  if (cleaned.startsWith("0")) {
    cleaned = "27" + cleaned.slice(1);
  }

  // If starts with +, remove it for wa.me
  if (cleaned.startsWith("+")) {
    cleaned = cleaned.slice(1);
  }

  return cleaned;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function GET() {
  try {
    const usersSnapshot = await db.collection("users").get();
    const reports: ReportItem[] = [];

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const weekKey = formatWeekKey();

    for (const userDoc of usersSnapshot.docs) {
      const userData = userDoc.data();

      // Skip if already sent for this week
      const sendDocId = `${weekKey}_${userDoc.id}`;
      const alreadySentDoc = await db.collection("weeklyReportSends").doc(sendDocId).get();
      if (alreadySentDoc.exists) continue;

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
        const d = firstLog.createdAt?.toDate
          ? firstLog.createdAt.toDate()
          : new Date();
        monthLabel = d.toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
        });
      }

      let reportText = `السلام عليكم ورحمة الله وبركاته

*Weekly Hifdh Report*
*Student:* ${userData.username ?? "-"}
*Ustad:* Moulana معاذ
*Month:* ${monthLabel}

`;

      if (recentLogs.length > 0) {
        recentLogs.forEach((logDoc, index) => {
          const logData = logDoc.data();
          const dateObj = logData.createdAt?.toDate
            ? logData.createdAt.toDate()
            : new Date();

          const dayName = dateObj.toLocaleDateString("en-US", {
            weekday: "short",
          });
          const dateFormatted = dateObj.toLocaleDateString("en-US", {
            day: "numeric",
            month: "short",
          });

          reportText += `*${dayName} ${dateFormatted}*\n\n`;

          reportText += `*Sabak:* ${logData.sabak ?? "-"} | ${logData.sabakReadQuality ?? "-"}\n`;
          if (logData.sabakReadNotes) {
            reportText += `Note: ${logData.sabakReadNotes}\n`;
          }
          reportText += `\n`;

          reportText += `*Sabak Dhor:* ${logData.sabakDhor ?? "-"} | ${logData.sabakDhorReadQuality ?? "-"}\n`;
          if (logData.sabakDhorReadNotes) {
            reportText += `Note: ${logData.sabakDhorReadNotes}\n`;
          }
          reportText += `\n`;

          reportText += `*Dhor:* ${logData.dhor ?? "-"} | ${logData.dhorReadQuality ?? "-"}\n`;
          if (logData.dhorReadNotes) {
            reportText += `Note: ${logData.dhorReadNotes}\n`;
          }
          reportText += `\n`;

          if (index !== recentLogs.length - 1) {
            reportText += `──────────────\n\n`;
          }
        });

        const latestLog = recentLogs[0].data();
        const goalStatus = latestLog.weeklyGoalCompleted ? "Completed" : "In Progress";

        reportText += `*Weekly Goal:* ${latestLog.weeklyGoal ?? "-"}\n`;
        reportText += `*Goal Status:* ${goalStatus}\n`;
        reportText += `Duration: ${latestLog.weeklyGoalDurationDays ?? "-"} days\n\n`;
        reportText += `────────────────\n*Powered by The Hifdh Journal*`;
      } else {
        reportText += `No logs recorded for the last 7 days.\n\n────────────────\n*Powered by The Hifdh Journal*`;
      }

      reports.push({
        studentId: userDoc.id,
        student: userData.username ?? "Unknown Student",
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
            <div class="phone">Parent: ${escapeHtml(r.parentPhone || "No parent number saved")}</div>
            <pre>${escapeHtml(r.report)}</pre>

            <div class="btn-row">
              <button
                class="copy-btn"
                onclick="navigator.clipboard.writeText(${JSON.stringify(r.report)})"
              >
                Copy Report
              </button>

              ${
                r.parentPhone
                  ? `<a
                      href="${whatsappUrl}"
                      target="_blank"
                      class="btn wa-btn"
                      onclick="markAsSent('${r.studentId}', '${r.weekKey}')"
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

          <script>
            async function markAsSent(studentId, weekKey) {
              try {
                await fetch(window.location.pathname, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json"
                  },
                  body: JSON.stringify({ studentId, weekKey })
                });

                const card = document.getElementById("card-" + studentId);
                if (card) {
                  card.remove();
                }

                if (!document.querySelector(".card")) {
                  const wrap = document.querySelector(".wrap");
                  const existingEmpty = document.querySelector(".empty");
                  if (!existingEmpty && wrap) {
                    const div = document.createElement("div");
                    div.className = "empty";
                    div.textContent = "All reports for this week have been handled.";
                    wrap.appendChild(div);
                  }
                }
              } catch (error) {
                console.error("Failed to mark as sent", error);
              }
            }
          </script>
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