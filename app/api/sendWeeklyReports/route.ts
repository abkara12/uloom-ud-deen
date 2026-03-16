import admin from "firebase-admin";
import Twilio from "twilio";

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

const twilioClient = Twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

export async function GET() {
  try {
    const usersSnapshot = await db.collection("users").get();
    const reports: any[] = [];

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

      let reportText = `السلام عليكم ورحمة الله وبركاته

📖 Weekly Hifdh Report
Student: ${userData.username}

`;

      if (recentLogs.length > 0) {
        recentLogs.forEach((logDoc) => {
          const logData = logDoc.data();

          const dateObj = logData.createdAt?.toDate
            ? logData.createdAt.toDate()
            : new Date();

          const dayName = dateObj.toLocaleDateString("en-US", {
            weekday: "short",
          });

          const dateString = dateObj.toISOString().split("T")[0];

          reportText += `${dayName} ${dateString}

Sabak: ${logData.sabak ?? "-"} | ${logData.sabakReadQuality ?? "-"}
Note: ${logData.sabakReadNotes ?? "-"}

Sabak Dhor: ${logData.sabakDhor ?? "-"} | ${logData.sabakDhorReadQuality ?? "-"}
Note: ${logData.sabakDhorReadNotes ?? "-"}

Dhor: ${logData.dhor ?? "-"} | ${logData.dhorReadQuality ?? "-"}
Note: ${logData.dhorReadNotes ?? "-"}

Mistakes: Sabak Dhor ${logData.sabakDhorMistakes ?? "0"} | Dhor ${
            logData.dhorMistakes ?? "0"
          }

`;
        });

        const latestLog = recentLogs[0].data();

        reportText += `🎯 Weekly Goal: ${latestLog.weeklyGoal ?? "-"}
📊 Goal Status: ${
          latestLog.weeklyGoalCompleted ? "Completed" : "In Progress"
        }
Duration: ${latestLog.weeklyGoalDurationDays ?? "-"}
`;
      } else {
        reportText += `No logs recorded for the last 7 days.`;
      }

      reports.push({
        student: userData.username,
        parentPhone: userData.parentPhone,
        report: reportText.trim(),
      });

      if (userData.parentPhone) {
        await twilioClient.messages.create({
          from: `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`,
          to: `whatsapp:${userData.parentPhone}`,
          body: reportText.trim(),
        });
      }
    }

    return new Response(JSON.stringify({ reports, sent: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}