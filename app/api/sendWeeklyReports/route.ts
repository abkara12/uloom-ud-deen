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

const twilioClient = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

export async function GET() {
  try {
    const usersSnapshot = await db.collection("users").get();
    const reports: any[] = [];

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    for (const userDoc of usersSnapshot.docs) {
      const userData = userDoc.data();

      // Get logs subcollection
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

      let reportText = `Assalaamu Alaikum\n\nWeekly Hifdh Report\nStudent: ${userData.username}\n📅 ${new Date().toLocaleDateString()}\n\n`;

      if (recentLogs.length > 0) {
        recentLogs.forEach((logDoc) => {
          const logData = logDoc.data();
          reportText += `Log Date: ${logData.createdAt?.toDate ? logData.createdAt.toDate().toLocaleString() : logData.createdAt}\n`;
          reportText += `Dhor: ${logData.dhor ?? "-"}\n`;
          reportText += `Dhor Mistakes: ${logData.dhorMistakes ?? "-"}\n`;
          reportText += `Dhor Read Notes: ${logData.dhorReadNotes ?? "-"}\n`;
          reportText += `Dhor Read Quality: ${logData.dhorReadQuality ?? "-"}\n`;
          reportText += `Sabak: ${logData.sabak ?? "-"}\n`;
          reportText += `Sabak Dhor: ${logData.sabakDhor ?? "-"}\n`;
          reportText += `Sabak Dhor Mistakes: ${logData.sabakDhorMistakes ?? "-"}\n`;
          reportText += `Sabak Dhor Read Notes: ${logData.sabakDhorReadNotes ?? "-"}\n`;
          reportText += `Sabak Dhor Read Quality: ${logData.sabakDhorReadQuality ?? "-"}\n`;
          reportText += `Sabak Read Notes: ${logData.sabakReadNotes ?? "-"}\n`;
          reportText += `Sabak Read Quality: ${logData.sabakReadQuality ?? "-"}\n\n`;

          // Weekly goal info from the log
          reportText += `Weekly Goal: ${logData.weeklyGoal ?? "-"}\n`;
          reportText += `Goal Start Date: ${logData.weeklyGoalStartDateKey ?? "-"}\n`;
          reportText += `Goal Week Key: ${logData.weeklyGoalWeekKey ?? "-"}\n`;
          reportText += `Goal Completed: ${logData.weeklyGoalCompleted ?? "-"}\n`;
          reportText += `Goal Completed Date: ${logData.weeklyGoalCompletedDateKey ?? "-"}\n`;
          reportText += `Goal Duration (days): ${logData.weeklyGoalDurationDays ?? "-"}\n\n`;
        });
      } else {
        reportText += `No logs for the last 7 days.\n`;
      }

      reports.push({
        student: userData.username,
        parentPhone: userData.parentPhone,
        report: reportText.trim(),
      });

      // ----------------- Send WhatsApp -----------------
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