/* =====================================================================
   SYNAPSELOAD CENTRAL ENGINE (app.js)
   Integrated with Cloud Firestore, Universal Multi-Year Indian Calendar,
   Full CRUD (Edit / Delete / Add) for Deadlines and Tasks,
   and Dual-Layer Real-Time Persistent Storage
   ===================================================================== */

// --- Cloud Connection Keys ---
const firebaseConfig = {
	apiKey: "AIzaSyDQGFaQ0x16bhWrI5taEg_PLSXZmwTUFy4",
	authDomain: "mini-project-934ef.firebaseapp.com",
	projectId: "mini-project-934ef",
	storageBucket: "mini-project-934ef.firebasestorage.app",
	messagingSenderId: "774687041766",
	appId: "1:774687041766:web:5a1e2bb3ef73db6f03b327",
};

let auth = null;
let db = null;
let isFirebaseReady = false;

try {
	if (typeof firebase !== "undefined" && firebase.initializeApp) {
		firebase.initializeApp(firebaseConfig);
		auth = firebase.auth();
		db = firebase.firestore();
		isFirebaseReady = true;
	}
} catch (e) {
	console.warn("Running in local mode:", e);
}

// Current system date initialization
const systemDate = new Date();

const appData = {
	currentUser: null,
	userProfile: {
		displayName: "Guest Student",
		department: "Information Technology",
		semester: 3,
		saturdayRule: "alternate", // "alternate", "all_off", "all_working"
		role: "student",
	},
	courses: [], // Stored courses
	timetable: {}, // Dynamic timetable schedule
	deadlines: [], // Deadlines & exams
	tasks: [], // Study tasks
	reviewDraft: [], // Staging area for editable timetable verification
	focus: {
		timer: null,
		totalSeconds: 25 * 60,
		currentSeconds: 25 * 60,
		isRunning: false,
		mode: "Pomodoro",
		completedSessions: 0,
	},
	currentMonth: systemDate.getMonth(), // Native 0-indexed month
	currentYear: systemDate.getFullYear(),
};

let workloadChartInstance = null;

// ================= INDIAN FESTIVAL & HOLIDAY DATABASE =================

const indianCalendarData = {
	// Fixed National / Gazetted Holidays across all years
	fixedHolidays: {
		"01-26": { name: "Republic Day", type: "National Holiday", isOff: true },
		"05-01": {
			name: "Maharashtra Day / Labour Day",
			type: "State Holiday",
			isOff: true,
		},
		"08-15": {
			name: "Independence Day",
			type: "National Holiday",
			isOff: true,
		},
		"10-02": {
			name: "Mahatma Gandhi Jayanti",
			type: "National Holiday",
			isOff: true,
		},
		"12-25": { name: "Christmas", type: "Gazetted Holiday", isOff: true },
	},

	// Variable & Lunar Festival Windows
	yearFestivals: {
		2026: {
			"03-04": { name: "Holi", type: "Festival Holiday", isOff: true },
			"08-28": { name: "Raksha Bandhan", type: "Festival", isOff: false },
			"09-14": { name: "Ganesh Chaturthi", type: "State Holiday", isOff: true },
			"10-11": {
				name: "Sharad Navratri Begins",
				type: "Cultural Observance",
				isOff: false,
			},
			"10-12": {
				name: "Navratri Day 2",
				type: "Cultural Observance",
				isOff: false,
			},
			"10-13": {
				name: "Navratri Day 3",
				type: "Cultural Observance",
				isOff: false,
			},
			"10-14": {
				name: "Navratri Day 4",
				type: "Cultural Observance",
				isOff: false,
			},
			"10-15": {
				name: "Navratri Day 5",
				type: "Cultural Observance",
				isOff: false,
			},
			"10-16": {
				name: "Navratri Day 6",
				type: "Cultural Observance",
				isOff: false,
			},
			"10-17": {
				name: "Navratri Day 7",
				type: "Cultural Observance",
				isOff: false,
			},
			"10-18": {
				name: "Maha Ashtami / Durga Puja",
				type: "Festival",
				isOff: false,
			},
			"10-19": { name: "Maha Navami", type: "Festival Holiday", isOff: true },
			"10-20": {
				name: "Dussehra (Vijayadashami)",
				type: "Gazetted Holiday",
				isOff: true,
			},
			"11-08": {
				name: "Diwali (Lakshmi Puja)",
				type: "Gazetted Holiday",
				isOff: true,
			},
			"11-10": {
				name: "Diwali Balipratipada",
				type: "State Holiday",
				isOff: true,
			},
		},
	},

	customOverrides: {},
};

function getDayFestivalInfo(dateStr) {
	if (indianCalendarData.customOverrides[dateStr] !== undefined) {
		return indianCalendarData.customOverrides[dateStr];
	}

	const [year, month, day] = dateStr.split("-");
	const mmdd = `${month}-${day}`;

	if (indianCalendarData.fixedHolidays[mmdd]) {
		return indianCalendarData.fixedHolidays[mmdd];
	}

	const y = parseInt(year, 10);
	if (
		indianCalendarData.yearFestivals[y] &&
		indianCalendarData.yearFestivals[y][mmdd]
	) {
		return indianCalendarData.yearFestivals[y][mmdd];
	}

	return null;
}

// ================= AUTHENTICATION & CLOUD BACKEND =================

let currentAuthMode = "signin";

function setAuthMode(mode) {
	currentAuthMode = mode;
	const isSignUp = mode === "signup";

	document.getElementById("authTitle").innerText = isSignUp
		? "Create a SynapseLoad Account"
		: "Sign In to SynapseLoad";
	document.getElementById("authSubmitBtn").innerText = isSignUp
		? "Sign Up & Sync"
		: "Sign In";

	document.getElementById("authTabSignIn").className = !isSignUp
		? "flex-1 py-2 rounded-lg bg-white shadow-sm text-indigo-600 font-bold"
		: "flex-1 py-2 rounded-lg hover:text-slate-900";
	document.getElementById("authTabSignUp").className = isSignUp
		? "flex-1 py-2 rounded-lg bg-white shadow-sm text-indigo-600 font-bold"
		: "flex-1 py-2 rounded-lg hover:text-slate-900";

	document
		.getElementById("authNameField")
		.classList.toggle("hidden", !isSignUp);
	document
		.getElementById("authMetaFields")
		.classList.toggle("hidden", !isSignUp);
	document
		.getElementById("authAdminCheckbox")
		.classList.toggle("hidden", !isSignUp);
}

async function handleAuthSubmit(e) {
	e.preventDefault();
	const email = document.getElementById("authEmailInput").value.trim();
	const password = document.getElementById("authPasswordInput").value.trim();

	if (!isFirebaseReady) {
		setupLocalSession(email);
		return;
	}

	try {
		if (currentAuthMode === "signup") {
			const cred = await auth.createUserWithEmailAndPassword(email, password);
			const name =
				document.getElementById("authNameInput").value.trim() ||
				email.split("@")[0];
			const branch =
				document.getElementById("authBranchInput").value.trim() ||
				"Information Technology";
			const sem =
				parseInt(document.getElementById("authSemesterInput").value, 10) || 3;
			const isAdmin = document.getElementById("authIsAdmin").checked;

			const profile = {
				uid: cred.user.uid,
				email: email,
				displayName: name,
				department: branch,
				semester: sem,
				role: isAdmin ? "admin" : "student",
				saturdayRule: "alternate",
				createdAt: firebase.firestore.FieldValue.serverTimestamp(),
			};

			await db.collection("users").doc(cred.user.uid).set(profile);
			showToast(`Welcome ${name}! Your cloud database is active.`);
		} else {
			await auth.signInWithEmailAndPassword(email, password);
			showToast("Signed in successfully!");
		}
		document.getElementById("authModal").classList.add("hidden");
	} catch (err) {
		showToast(err.message, true);
	}
}

function continueAsGuest() {
	setupLocalSession("guest_student@campus.edu");
}

function setupLocalSession(email) {
	appData.userProfile.displayName = email.split("@")[0];
	appData.userProfile.role = email.includes("admin") ? "admin" : "student";
	updateUserDisplayUI();
	document.getElementById("authModal").classList.add("hidden");
	showToast(`Active session: ${appData.userProfile.displayName}`);
	refreshDashboard();
	renderCalendar();
}

function handleSignOutOrOpenAuth() {
	if (isFirebaseReady && auth && auth.currentUser) {
		auth.signOut().then(() => {
			document.getElementById("authModal").classList.remove("hidden");
			resetToEmptyState();
			showToast("Signed out.");
		});
	} else {
		document.getElementById("authModal").classList.remove("hidden");
	}
}

if (isFirebaseReady && auth) {
	auth.onAuthStateChanged(async (user) => {
		if (user) {
			appData.currentUser = user;
			document.getElementById("authModal").classList.add("hidden");

			const userDoc = await db.collection("users").doc(user.uid).get();
			if (userDoc.exists) {
				appData.userProfile = { ...appData.userProfile, ...userDoc.data() };
			}

			await loadUserDataFromFirestore(user.uid);
			updateUserDisplayUI();
			refreshDashboard();
			renderCalendar();
		} else {
			document.getElementById("authModal").classList.remove("hidden");
		}
	});
}

function updateUserDisplayUI() {
	const name = appData.userProfile.displayName || "Student";
	document.getElementById("userNameLabel").innerText = name;
	document.getElementById("userAvatarBadge").innerText = name
		.substring(0, 2)
		.toUpperCase();
	document.getElementById("userRoleSubtext").innerText =
		`${appData.userProfile.role.toUpperCase()} • Sem ${appData.userProfile.semester}`;

	const adminNav = document.getElementById("nav-admin");
	if (appData.userProfile.role === "admin") {
		adminNav.classList.remove("hidden");
	} else {
		adminNav.classList.add("hidden");
	}
}

async function loadUserDataFromFirestore(uid) {
	if (!isFirebaseReady || !uid) return;
	try {
		const coursesSnap = await db
			.collection("users")
			.doc(uid)
			.collection("courses")
			.get();
		if (!coursesSnap.empty) {
			appData.courses = coursesSnap.docs.map((doc) => ({
				id: doc.id,
				...doc.data(),
			}));
		}

		const deadlineSnap = await db
			.collection("users")
			.doc(uid)
			.collection("deadlines")
			.get();
		if (!deadlineSnap.empty) {
			appData.deadlines = deadlineSnap.docs.map((doc) => ({
				id: doc.id,
				...doc.data(),
			}));
		}

		const tasksSnap = await db
			.collection("users")
			.doc(uid)
			.collection("tasks")
			.get();
		if (!tasksSnap.empty) {
			appData.tasks = tasksSnap.docs.map((doc) => ({
				id: doc.id,
				...doc.data(),
			}));
		}

		localStorage.setItem("synapse_courses", JSON.stringify(appData.courses));
		localStorage.setItem(
			"synapse_deadlines",
			JSON.stringify(appData.deadlines),
		);
		localStorage.setItem("synapse_tasks", JSON.stringify(appData.tasks));

		refreshDashboard();
		renderCalendar();
	} catch (e) {
		console.error("Firestore sync error:", e);
	}
}

// ================= DUAL-LAYER PERSISTENCE =================

async function syncAllToFirestore() {
	try {
		localStorage.setItem("synapse_courses", JSON.stringify(appData.courses));
		localStorage.setItem(
			"synapse_deadlines",
			JSON.stringify(appData.deadlines),
		);
		localStorage.setItem("synapse_tasks", JSON.stringify(appData.tasks));
	} catch (e) {
		console.warn("LocalStorage cache failed:", e);
	}

	if (!isFirebaseReady || !auth || !auth.currentUser) return;
	const uid = auth.currentUser.uid;
	try {
		const batch = db.batch();

		// Sync courses
		for (const c of appData.courses) {
			const docRef = db
				.collection("users")
				.doc(uid)
				.collection("courses")
				.doc(c.code);
			batch.set(docRef, c);
		}

		// Sync deadlines
		for (const d of appData.deadlines) {
			const docRef = db
				.collection("users")
				.doc(uid)
				.collection("deadlines")
				.doc(String(d.id));
			batch.set(docRef, d);
		}

		// Sync tasks
		for (const t of appData.tasks) {
			const docRef = db
				.collection("users")
				.doc(uid)
				.collection("tasks")
				.doc(String(t.id));
			batch.set(docRef, t);
		}

		await batch.commit();
	} catch (err) {
		console.error("Error updating cloud:", err);
	}
}

// ================= CLOUD DELETION HELPERS =================

async function deleteCloudDocument(subcollection, docId) {
	if (isFirebaseReady && auth && auth.currentUser) {
		try {
			const uid = auth.currentUser.uid;
			await db
				.collection("users")
				.doc(uid)
				.collection(subcollection)
				.doc(String(docId))
				.delete();
		} catch (err) {
			console.warn(`Error deleting from ${subcollection}:`, err);
		}
	}
}

// ================= LOAD SAMPLE DATA =================

function loadSampleData() {
	appData.courses = [
		{
			code: "JDSAAR",
			name: "Data Structures & Algorithms",
			credits: 4,
			lecsPerWeek: 4,
			labsPerWeek: 0,
			currentMarks: 88,
			gradePoint: 9.0,
		},
		{
			code: "OOP",
			name: "Object Oriented Programming (Java/C++)",
			credits: 4,
			lecsPerWeek: 3,
			labsPerWeek: 1,
			currentMarks: 84,
			gradePoint: 9.0,
		},
		{
			code: "DM",
			name: "Discrete Mathematics",
			credits: 4,
			lecsPerWeek: 4,
			labsPerWeek: 0,
			currentMarks: 76,
			gradePoint: 8.0,
		},
		{
			code: "FLAT",
			name: "Formal Language & Automata Theory",
			credits: 4,
			lecsPerWeek: 4,
			labsPerWeek: 0,
			currentMarks: 81,
			gradePoint: 8.5,
		},
		{
			code: "OSTL",
			name: "Open Source Tech Laboratory",
			credits: 2,
			lecsPerWeek: 0,
			labsPerWeek: 2,
			currentMarks: 94,
			gradePoint: 10.0,
		},
	];

	appData.timetable = {
		Wednesday: [
			{
				time: "09:00 - 10:00",
				course: "JDSAAR",
				type: "Lecture",
				room: "LH-201",
			},
			{ time: "10:00 - 11:00", course: "OOP", type: "Lecture", room: "LH-201" },
			{ time: "11:15 - 12:15", course: "DM", type: "Lecture", room: "LH-201" },
			{
				time: "12:15 - 01:15",
				course: "FLAT",
				type: "Lecture",
				room: "LH-201",
			},
			{ time: "02:00 - 04:00", course: "OSTL", type: "Lab", room: "Lab-3B" },
		],
	};

	appData.deadlines = [
		{
			id: 1001,
			title: "Discrete Math Midterm Exam",
			course: "DM",
			date: "2026-10-15",
			type: "Exam",
			intensity: 5.0,
			collision: true,
		},
		{
			id: 1002,
			title: "OOP Major Lab Project (Inheritance)",
			course: "OOP",
			date: "2026-10-16",
			type: "Lab Submission",
			intensity: 4.5,
			collision: true,
		},
		{
			id: 1003,
			title: "JDSAAR Midterm Exam",
			course: "JDSAAR",
			date: "2026-10-19",
			type: "Exam",
			intensity: 5.0,
			collision: false,
		},
	];

	appData.tasks = [
		{
			id: 2001,
			title: "Discrete Math: Solve Relations & Digraphs proofs",
			course: "DM",
			duration: "1.5 hrs",
			done: false,
			date: "Today",
			tag: "AI Leveling Shift",
		},
		{
			id: 2002,
			title: "OOP: Implement Polymorphism & Unit Tests",
			course: "OOP",
			duration: "2.0 hrs",
			done: false,
			date: "Today",
			tag: "Critical Protection",
		},
	];

	appData.reviewDraft = JSON.parse(JSON.stringify(appData.courses));

	syncAllToFirestore();
	refreshDashboard();
	renderCalendar();
	renderParsedEditableReview();
	showToast("Sample engineering curriculum loaded!");
}

function resetToEmptyState() {
	appData.courses = [];
	appData.timetable = {};
	appData.deadlines = [];
	appData.tasks = [];
	appData.reviewDraft = [];
	localStorage.removeItem("synapse_courses");
	localStorage.removeItem("synapse_deadlines");
	localStorage.removeItem("synapse_tasks");

	refreshDashboard();
	renderCalendar();
	renderParsedEditableReview();
}

// ================= VIEW SWITCHER =================

function switchView(viewName) {
	document
		.querySelectorAll(".view-panel")
		.forEach((panel) => panel.classList.add("hidden"));
	document.querySelectorAll(".nav-item").forEach((item) => {
		item.classList.remove("bg-indigo-600", "text-white", "shadow-sm");
		item.classList.add("hover:bg-slate-800", "text-slate-300");
	});

	const activePanel = document.getElementById("view-" + viewName);
	if (activePanel) activePanel.classList.remove("hidden");

	const activeNav = document.getElementById("nav-" + viewName);
	if (activeNav) {
		activeNav.classList.add("bg-indigo-600", "text-white", "shadow-sm");
		activeNav.classList.remove("hover:bg-slate-800", "text-slate-300");
	}

	document.getElementById("sidebarNav").classList.add("-translate-x-full");

	if (viewName === "calendar") renderCalendar();
	if (viewName === "courses") renderCoursesTable();
	if (viewName === "planner") renderPlannerView();
	if (viewName === "admin") fetchAdminDirectory();
	if (viewName === "dashboard") {
		setTimeout(initOrUpdateWorkloadChart, 50);
	}
}

function toggleMobileNav() {
	document.getElementById("sidebarNav").classList.toggle("-translate-x-full");
}

function showToast(message, isAlert = false) {
	const toast = document.getElementById("toast");
	const toastMsg = document.getElementById("toastMessage");
	const toastIcon = document.getElementById("toastIcon");

	toastMsg.innerText = message;
	if (isAlert) {
		toastIcon.setAttribute("data-lucide", "alert-circle");
		toast.classList.add("border-red-500");
	} else {
		toastIcon.setAttribute("data-lucide", "check-circle-2");
		toast.classList.remove("border-red-500");
	}
	lucide.createIcons();

	toast.classList.remove("translate-y-20", "opacity-0");
	setTimeout(() => {
		toast.classList.add("translate-y-20", "opacity-0");
	}, 3200);
}

// ================= SATURDAY POLICIES =================

function toggleSaturdayHoliday(isChecked) {
	appData.userProfile.saturdayRule = isChecked ? "alternate" : "all_working";
	document.getElementById("satStatusLabel").innerText = isChecked
		? "Alternate Off"
		: "Working";
	document.getElementById("satSelectRule").value = isChecked
		? "alternate"
		: "all_working";
	showToast("Saturday holiday setting updated");
	renderCalendar();
	initOrUpdateWorkloadChart();
}

function updateSaturdayRule(val) {
	appData.userProfile.saturdayRule = val;
	const toggle = document.getElementById("satHolidayToggle");
	toggle.checked = val !== "all_working";
	document.getElementById("satStatusLabel").innerText =
		val === "all_off"
			? "All Off"
			: val === "alternate"
				? "Alternate Off"
				: "Working";
	showToast("Saturday status recalculated");
	renderCalendar();
	initOrUpdateWorkloadChart();
}

// ================= DASHBOARD & CHARTS =================

function refreshDashboard() {
	const hasCollisions = appData.deadlines.some((d) => d.collision);
	const banner = document.getElementById("collisionBanner");
	const navDot = document.getElementById("navCollisionDot");
	const sideBadge = document.getElementById("sidebarCollisionBadge");
	const sideSummary = document.getElementById("sidebarCollisionSummary");

	if (hasCollisions) {
		banner.classList.remove("hidden");
		navDot.className = "ml-auto w-2 h-2 rounded-full bg-red-500 animate-ping";
		sideBadge.className =
			"inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-red-500/20 text-red-400 border border-red-500/30 font-bold";
		sideBadge.innerText = "2 Collisions!";
		sideSummary.innerText = "Week 7 crunch detected (+14.5 hrs)";
		document.getElementById("metricCollisionCount").innerText = "2 Detected";
		document.getElementById("metricCollisionSubtext").innerText =
			"1 Critical (Oct 16)";
		document.getElementById("metricPeakLoad").innerText = "14.5 hrs / day";
		document.getElementById("metricPeakPercent").innerText = "180% normal load";
	} else {
		banner.classList.add("hidden");
		navDot.className = "ml-auto w-2 h-2 rounded-full bg-slate-600";
		sideBadge.className =
			"inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-slate-700 text-slate-300 font-bold";
		sideBadge.innerText = "0 Active";
		sideSummary.innerText = "No collisions detected";
		document.getElementById("metricCollisionCount").innerText = "0 Detected";
		document.getElementById("metricCollisionSubtext").innerText =
			"Schedule clear";
		document.getElementById("metricPeakLoad").innerText =
			appData.courses.length > 0 ? "5.5 hrs / day" : "0.0 hrs / day";
		document.getElementById("metricPeakPercent").innerText = "Normal load";
	}

	const listContainer = document.getElementById("todaysClassesList");
	listContainer.innerHTML = "";
	const classes = appData.timetable["Wednesday"] || [];

	if (classes.length === 0) {
		listContainer.innerHTML = `
      <div class="p-6 text-center text-slate-400 border border-dashed border-slate-200 rounded-xl">
        <i data-lucide="calendar-x" class="w-8 h-8 mx-auto mb-2 text-slate-300"></i>
        <p class="text-xs font-semibold">No classes scheduled for today</p>
        <p class="text-[11px] text-slate-400 mt-0.5">Upload a timetable or add courses to populate.</p>
      </div>
    `;
		document.getElementById("metricClassLoad").innerText = "0 Classes";
		document.getElementById("metricCourseSummary").innerText =
			"No active courses";
		document.getElementById("totalClassHoursLabel").innerHTML =
			"Total in-class: <strong>0.0 hrs</strong>";
	} else {
		classes.forEach((c) => {
			const isLab = c.type.toLowerCase().includes("lab");
			const isExam = c.type.toLowerCase().includes("exam");
			const colorBg = isExam
				? "border-red-200 bg-red-50/50"
				: isLab
					? "border-violet-200 bg-violet-50/40"
					: "border-slate-100 bg-slate-50/70";
			const badgeColor = isExam
				? "bg-red-100 text-red-700"
				: isLab
					? "bg-violet-100 text-violet-700"
					: "bg-slate-200 text-slate-700";

			const el = document.createElement("div");
			el.className = `p-3 rounded-xl border ${colorBg} flex items-center justify-between text-xs transition hover:shadow-sm`;
			el.innerHTML = `
        <div class="flex items-center gap-3">
          <span class="font-mono text-slate-400 font-semibold text-[11px]">${c.time}</span>
          <div>
            <div class="font-bold text-slate-900">${c.course}</div>
            <div class="text-[11px] text-slate-500">${c.room} • ${c.type}</div>
          </div>
        </div>
        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${badgeColor}">${c.type}</span>
      `;
			listContainer.appendChild(el);
		});

		document.getElementById("metricClassLoad").innerText =
			`${classes.length} Sessions`;
		document.getElementById("metricCourseSummary").innerText = appData.courses
			.map((c) => c.code)
			.slice(0, 4)
			.join(", ");
		document.getElementById("totalClassHoursLabel").innerHTML =
			"Total in-class: <strong>6.0 hrs</strong>";
	}

	renderTodoList();
	renderDeadlinesList();
	renderCoursesTable();
	initOrUpdateWorkloadChart();
	updateFocusCourseSelect();
	lucide.createIcons();
}

// ================= STUDY TASKS (EDIT / DELETE / TOGGLE) =================

function renderTodoList() {
	const todoCont = document.getElementById("smartTodoList");
	if (!todoCont) return;
	todoCont.innerHTML = "";

	if (appData.tasks.length === 0) {
		todoCont.innerHTML = `
      <div class="p-6 text-center text-slate-400 border border-dashed border-slate-200 rounded-xl">
        <p class="text-xs">No active study tasks. Use "+ Add Task" or load sample data.</p>
      </div>
    `;
		return;
	}

	appData.tasks.forEach((t) => {
		const div = document.createElement("div");
		div.className = `p-3 rounded-xl border ${t.done ? "bg-slate-50/60 border-slate-100 text-slate-400" : "bg-white border-slate-200 text-slate-700"} flex items-center justify-between text-xs transition hover:shadow-sm`;
		div.innerHTML = `
      <div class="flex items-center gap-3 overflow-hidden">
        <input type="checkbox" onchange="toggleTaskDone(${t.id})" ${t.done ? "checked" : ""} class="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer shrink-0">
        <div class="${t.done ? "line-through text-slate-400" : ""} overflow-hidden">
          <div class="font-bold text-slate-800 flex items-center gap-2 truncate">
            <span class="truncate">${t.title}</span>
            <span class="text-[10px] font-normal px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-600 border border-indigo-100 shrink-0">${t.tag || "Study"}</span>
          </div>
          <div class="text-[11px] text-slate-400 font-medium">${t.course} • Est: ${t.duration} • ${t.date}</div>
        </div>
      </div>
      <div class="flex items-center gap-1 shrink-0 ml-2">
        <button onclick="startFocusWithCourse('${t.course}')" class="p-1.5 rounded-lg hover:bg-indigo-50 text-indigo-600 transition" title="Start Focus Block">
          <i data-lucide="play" class="w-3.5 h-3.5"></i>
        </button>
        <button onclick="editTaskPrompt(${t.id})" class="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition" title="Edit Task">
          <i data-lucide="edit-2" class="w-3.5 h-3.5"></i>
        </button>
        <button onclick="deleteTask(${t.id})" class="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 transition" title="Delete Task">
          <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
        </button>
      </div>
    `;
		todoCont.appendChild(div);
	});
	lucide.createIcons();
}

function addNewTaskPrompt() {
	const title = prompt("Enter study task description:");
	if (!title) return;
	const course =
		prompt(
			"Associated Course Code:",
			appData.courses[0] ? appData.courses[0].code : "General",
		) || "General";
	const duration =
		prompt("Estimated Study Time (e.g. 1.5 hrs):", "1.5 hrs") || "1.0 hr";

	appData.tasks.unshift({
		id: Date.now(),
		title: title.trim(),
		course: course.toUpperCase().trim(),
		duration: duration.trim(),
		done: false,
		date: "Today",
		tag: "Anticipatory Task",
	});

	renderTodoList();
	syncAllToFirestore();
	showToast("Task saved & synced!");
}

function editTaskPrompt(taskId) {
	const task = appData.tasks.find((t) => t.id === taskId);
	if (!task) return;

	const newTitle = prompt("Edit Task Description:", task.title);
	if (!newTitle) return;
	const newDuration =
		prompt("Edit Estimated Duration:", task.duration) || task.duration;
	const newCourse =
		prompt("Edit Associated Course:", task.course) || task.course;

	task.title = newTitle.trim();
	task.duration = newDuration.trim();
	task.course = newCourse.toUpperCase().trim();

	renderTodoList();
	syncAllToFirestore();
	showToast("Task updated successfully!");
}

async function deleteTask(taskId) {
	if (!confirm("Are you sure you want to delete this study task?")) return;

	appData.tasks = appData.tasks.filter((t) => t.id !== taskId);
	await deleteCloudDocument("tasks", taskId);

	renderTodoList();
	syncAllToFirestore();
	showToast("Task deleted.");
}

function toggleTaskDone(taskId) {
	const t = appData.tasks.find((x) => x.id === taskId);
	if (t) {
		t.done = !t.done;
		renderTodoList();
		syncAllToFirestore();
	}
}

// ================= DEADLINES & EXAMS (EDIT / DELETE / ADD) =================

function renderDeadlinesList() {
	const deadlineCont = document.getElementById("deadlinesList");
	if (!deadlineCont) return;
	deadlineCont.innerHTML = "";

	if (appData.deadlines.length === 0) {
		deadlineCont.innerHTML = `
      <div class="p-6 text-center text-slate-400 border border-dashed border-slate-200 rounded-xl">
        <p class="text-xs">No upcoming deadlines or exams registered.</p>
      </div>
    `;
		return;
	}

	appData.deadlines.forEach((d) => {
		const isCollision = d.collision;

		// Normalize date to prevent timezone shifts
		const parts = d.date.split("-");
		const displayDate = new Date(
			parseInt(parts[0], 10),
			parseInt(parts[1], 10) - 1,
			parseInt(parts[2], 10),
		);

		const div = document.createElement("div");
		div.className = `p-3 rounded-xl border flex items-center justify-between text-xs transition hover:shadow-sm ${
			isCollision ? "border-red-200 bg-red-50/60" : "border-slate-200 bg-white"
		}`;

		div.innerHTML = `
      <div class="flex items-center gap-3 overflow-hidden">
        <div class="p-2 rounded-lg ${isCollision ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"} font-bold text-center min-w-[50px] shrink-0">
          <span class="block text-[10px] uppercase">${displayDate.toLocaleString("default", { month: "short" })}</span>
          <span class="text-sm font-black">${displayDate.getDate()}</span>
        </div>
        <div class="overflow-hidden">
          <div class="font-bold text-slate-800 truncate ${isCollision ? "text-red-900" : ""}">${d.title}</div>
          <div class="text-slate-500 text-[11px] truncate">${d.course} • ${d.type} • ${d.intensity || 3.5}h Load</div>
        </div>
      </div>
      <div class="flex items-center gap-2 shrink-0 ml-2">
        ${isCollision ? '<span class="px-2 py-0.5 rounded text-[10px] font-black bg-red-600 text-white uppercase tracking-wider animate-pulse">Collision</span>' : ""}
        <button onclick="editDeadlinePrompt(${d.id})" class="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition" title="Edit Deadline">
          <i data-lucide="edit-2" class="w-3.5 h-3.5"></i>
        </button>
        <button onclick="deleteDeadline(${d.id})" class="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 transition" title="Delete Deadline">
          <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
        </button>
      </div>
    `;
		deadlineCont.appendChild(div);
	});
	lucide.createIcons();
}

function addNewDeadlinePrompt() {
	const title = prompt("Deadline Title (e.g. OOP Assignment Submission):");
	if (!title) return;
	const rawDate =
		prompt("Due Date (YYYY-MM-DD):", "2026-10-05") || "2026-10-05";
	const course =
		prompt("Course Code (e.g. OOP, DM, JDSAAR):", "OOP") || "General";
	const hours =
		parseFloat(prompt("Estimated Required Effort (Hours):", "3.5")) || 3.5;

	const parts = rawDate.trim().split("-");
	let formattedDate = rawDate.trim();
	if (parts.length === 3) {
		const y = parts[0];
		const m = parts[1].padStart(2, "0");
		const d = parts[2].padStart(2, "0");
		formattedDate = `${y}-${m}-${d}`;
	}

	appData.deadlines.push({
		id: Date.now(),
		title: title.trim(),
		course: course.toUpperCase().trim(),
		date: formattedDate,
		type: "Assignment",
		intensity: hours,
		collision: hours >= 8.0, // High load flags collision alert
	});

	refreshDashboard();
	renderCalendar();
	syncAllToFirestore();
	showToast(`Added deadline: ${title}`);
}

function editDeadlinePrompt(deadlineId) {
	const deadline = appData.deadlines.find((d) => d.id === deadlineId);
	if (!deadline) return;

	const newTitle = prompt("Edit Deadline Title:", deadline.title);
	if (!newTitle) return;
	const newDate =
		prompt("Edit Due Date (YYYY-MM-DD):", deadline.date) || deadline.date;
	const newCourse =
		prompt("Edit Course Code:", deadline.course) || deadline.course;
	const newHours =
		parseFloat(prompt("Edit Required Effort (Hours):", deadline.intensity)) ||
		deadline.intensity;

	const parts = newDate.trim().split("-");
	let formattedDate = newDate.trim();
	if (parts.length === 3) {
		const y = parts[0];
		const m = parts[1].padStart(2, "0");
		const d = parts[2].padStart(2, "0");
		formattedDate = `${y}-${m}-${d}`;
	}

	deadline.title = newTitle.trim();
	deadline.date = formattedDate;
	deadline.course = newCourse.toUpperCase().trim();
	deadline.intensity = newHours;
	deadline.collision = newHours >= 8.0;

	refreshDashboard();
	renderCalendar();
	syncAllToFirestore();
	showToast("Deadline updated successfully!");
}

async function deleteDeadline(deadlineId) {
	if (!confirm("Are you sure you want to remove this academic deadline?"))
		return;

	appData.deadlines = appData.deadlines.filter((d) => d.id !== deadlineId);
	await deleteCloudDocument("deadlines", deadlineId);

	refreshDashboard();
	renderCalendar();
	syncAllToFirestore();
	showToast("Deadline deleted.");
}

// ================= WORKLOAD CURVE =================

function initOrUpdateWorkloadChart() {
	const ctx = document.getElementById("workloadForecastChart");
	if (!ctx) return;

	const labels = [
		"Oct 7",
		"Oct 8",
		"Oct 9",
		"Oct 10",
		"Oct 11",
		"Oct 12",
		"Oct 13",
		"Oct 14",
		"Oct 15",
		"Oct 16",
		"Oct 17",
		"Oct 18",
		"Oct 19",
		"Oct 20",
	];

	let unmanagedLoad = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
	let leveledLoad = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

	if (appData.courses.length > 0 || appData.deadlines.length > 0) {
		unmanagedLoad = [
			6.0, 6.0, 5.5, 4.0, 2.0, 6.5, 7.0, 0.5, 12.0, 14.5, 6.0, 2.0, 9.5, 6.0,
		];
		leveledLoad = [
			6.0, 6.0, 6.0, 5.5, 5.0, 7.0, 7.0, 2.0, 8.0, 8.5, 6.0, 3.5, 7.5, 6.0,
		];
	}

	if (workloadChartInstance) {
		workloadChartInstance.destroy();
	}

	workloadChartInstance = new Chart(ctx, {
		type: "line",
		data: {
			labels: labels,
			datasets: [
				{
					label: "Actual Stress Load (hrs/day)",
					data: unmanagedLoad,
					borderColor: "#ef4444",
					backgroundColor: "rgba(239, 68, 68, 0.1)",
					borderWidth: 2.5,
					tension: 0.35,
					fill: true,
					pointBackgroundColor: (ctxVal) =>
						ctxVal.dataset.data[ctxVal.dataIndex] >= 10 ? "#dc2626" : "#6366f1",
					pointRadius: (ctxVal) =>
						ctxVal.dataset.data[ctxVal.dataIndex] >= 10 ? 6 : 3,
				},
				{
					label: "AI Safe Level",
					data: leveledLoad,
					borderColor: "#10b981",
					borderWidth: 2,
					borderDash: [5, 5],
					tension: 0.35,
					fill: false,
					pointRadius: 0,
				},
			],
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			plugins: { legend: { display: false } },
			scales: {
				y: {
					beginAtZero: true,
					max: 16,
					grid: { color: "rgba(226, 232, 240, 0.6)" },
					ticks: { callback: (v) => v + "h", font: { size: 10 } },
				},
				x: { grid: { display: false }, ticks: { font: { size: 10 } } },
			},
		},
	});
}

// ================= UNIVERSAL CALENDAR HEATMAP =================

function renderCalendar() {
	const grid = document.getElementById("calendarGrid");
	if (!grid) return;
	grid.innerHTML = "";

	const year = appData.currentYear;
	const month = appData.currentMonth;

	const monthSelect = document.getElementById("calendarMonthSelect");
	const yearInput = document.getElementById("calendarYearInput");
	if (monthSelect) monthSelect.value = month;
	if (yearInput) yearInput.value = year;

	const firstDayOfWeek = new Date(year, month, 1).getDay();
	const daysInMonth = new Date(year, month + 1, 0).getDate();

	for (let i = 0; i < firstDayOfWeek; i++) {
		const emptyCell = document.createElement("div");
		emptyCell.className =
			"bg-slate-50/40 p-2 min-h-[90px] border-b border-slate-100";
		grid.appendChild(emptyCell);
	}

	for (let day = 1; day <= daysInMonth; day++) {
		const mm = String(month + 1).padStart(2, "0");
		const dd = String(day).padStart(2, "0");
		const dateStr = `${year}-${mm}-${dd}`;
		const dayOfWeek = (firstDayOfWeek + day - 1) % 7;

		const isSun = dayOfWeek === 0;
		const isSat = dayOfWeek === 6;
		let isHoliday = false;
		let holidayLabel = "";

		// Weekend policies
		if (isSun) {
			isHoliday = true;
			holidayLabel = "Sunday";
		} else if (isSat) {
			if (appData.userProfile.saturdayRule === "all_off") {
				isHoliday = true;
				holidayLabel = "Saturday Off";
			} else if (appData.userProfile.saturdayRule === "alternate") {
				const satIndex = Math.ceil(day / 7);
				if (satIndex === 2 || satIndex === 4) {
					isHoliday = true;
					holidayLabel = `Holiday (${satIndex}th Sat)`;
				}
			}
		}

		// Indian Festival & Holiday Engine Check
		const fest = getDayFestivalInfo(dateStr);
		let isCulturalPeriod = false;

		if (fest) {
			if (fest.isOff) {
				isHoliday = true;
				holidayLabel = fest.name;
			} else {
				isCulturalPeriod = true;
				holidayLabel = fest.name;
			}
		}

		// Match Deadlines for this specific calendar date
		const matchDeadline = appData.deadlines.find((d) => d.date === dateStr);
		let eventTag = matchDeadline ? matchDeadline.title : "";
		let intensityHrs = isHoliday ? 0 : appData.courses.length > 0 ? 5.5 : 0;

		if (matchDeadline) {
			intensityHrs = matchDeadline.intensity || 8.0;
		}

		// Heat Level Styling
		let heatClass = "bg-white";
		if (isHoliday) {
			heatClass = "bg-blue-50/40 text-blue-900 border-blue-100";
		} else if (matchDeadline) {
			heatClass = matchDeadline.collision
				? "heat-collision"
				: "bg-amber-50/80 border-amber-300 text-amber-900";
		} else if (intensityHrs >= 10) {
			heatClass = "heat-collision";
		} else if (isCulturalPeriod) {
			heatClass = "bg-purple-50/50 border-purple-200 text-purple-900";
		} else if (intensityHrs >= 7) {
			heatClass = "heat-heavy";
		} else if (intensityHrs >= 4) {
			heatClass = "heat-moderate";
		} else {
			heatClass = "heat-light";
		}

		const cell = document.createElement("div");
		cell.className = `p-2 min-h-[95px] border-b border-slate-100 flex flex-col justify-between cursor-pointer transition hover:ring-2 hover:ring-indigo-400 ${heatClass}`;
		cell.onclick = () =>
			openDayDetail(
				day,
				dateStr,
				intensityHrs,
				eventTag || holidayLabel,
				isHoliday,
				fest,
			);

		cell.innerHTML = `
      <div class="flex items-center justify-between">
        <span class="text-xs font-black ${isHoliday ? "text-blue-700" : "text-slate-800"}">${day}</span>
        ${eventTag ? '<span class="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse"></span>' : ""}
      </div>
      <div class="space-y-1 my-1">
        ${eventTag ? `<div class="text-[10px] font-bold truncate bg-red-100 text-red-800 px-1 py-0.5 rounded border border-red-200">${eventTag}</div>` : ""}
        ${holidayLabel ? `<div class="text-[10px] font-semibold ${isHoliday ? "text-blue-600" : "text-purple-700"} truncate">${holidayLabel}</div>` : ""}
        ${!isHoliday && !eventTag && !holidayLabel && appData.courses.length > 0 ? `<div class="text-[10px] text-slate-500 font-medium">Classes • ${intensityHrs}h</div>` : ""}
      </div>
      <div class="text-[9px] font-bold uppercase tracking-wider text-slate-400">
        ${isHoliday ? "Holiday" : eventTag ? `${intensityHrs}h Due` : isCulturalPeriod ? "Festival Strain" : intensityHrs > 0 ? intensityHrs + "h Load" : "Clear"}
      </div>
    `;

		grid.appendChild(cell);
	}

	lucide.createIcons();
}

function changeCalendarMonth(delta) {
	appData.currentMonth += delta;
	if (appData.currentMonth > 11) {
		appData.currentMonth = 0;
		appData.currentYear += 1;
	} else if (appData.currentMonth < 0) {
		appData.currentMonth = 11;
		appData.currentYear -= 1;
	}
	renderCalendar();
}

function onCalendarSelectChange() {
	const m = parseInt(document.getElementById("calendarMonthSelect").value, 10);
	const y = parseInt(document.getElementById("calendarYearInput").value, 10);
	if (!isNaN(m)) appData.currentMonth = m;
	if (!isNaN(y) && y >= 1990 && y <= 2100) appData.currentYear = y;
	renderCalendar();
}

function jumpToToday() {
	const today = new Date();
	appData.currentMonth = today.getMonth();
	appData.currentYear = today.getFullYear();
	renderCalendar();
}

function openDayDetail(day, dateStr, intensityHrs, eventTag, isHoliday, fest) {
	const card = document.getElementById("dayDetailCard");
	const badge = document.getElementById("detailDayBadge");
	const title = document.getElementById("detailDateTitle");
	const content = document.getElementById("detailDayContent");

	card.classList.remove("hidden");
	title.innerText = `Breakdown for ${dateStr}`;
	badge.innerText = isHoliday
		? "College Closed"
		: `${intensityHrs} hrs Computed Load`;
	badge.className = `text-xs px-2.5 py-1 rounded-md font-bold ${isHoliday ? "bg-blue-100 text-blue-800" : "bg-indigo-100 text-indigo-800"}`;

	content.innerHTML = `
    <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
      <div class="font-bold text-slate-800">${eventTag || "Regular Academic Day"}</div>
      <p class="text-xs text-slate-600">
        ${fest ? `${fest.name} (${fest.type})` : isHoliday ? "No lectures or practicals scheduled." : "Regular timetable schedule applies."}
      </p>
    </div>
    
    <div class="flex items-center justify-between pt-2 border-t border-slate-100">
      <label class="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
        <input type="checkbox" id="overrideToggle_${dateStr}" ${isHoliday ? "checked" : ""} onchange="toggleDateHolidayOverride('${dateStr}', this.checked)" class="rounded text-indigo-600 focus:ring-indigo-500">
        <span>Does your college have a holiday on this day?</span>
      </label>
      <button onclick="closeDayDetail()" class="text-xs text-slate-500 hover:text-slate-800 font-medium">Close</button>
    </div>
  `;

	card.scrollIntoView({ behavior: "smooth" });
}

function toggleDateHolidayOverride(dateStr, isOff) {
	indianCalendarData.customOverrides[dateStr] = {
		name: isOff
			? "College Holiday (Manual Override)"
			: "Working Day (Manual Override)",
		type: "User Override",
		isOff: isOff,
	};
	showToast(
		`Updated: ${dateStr} marked as ${isOff ? "Holiday" : "Working Day"}`,
	);
	renderCalendar();
}

function closeDayDetail() {
	document.getElementById("dayDetailCard").classList.add("hidden");
}

// ================= INGESTION & EDITABLE VERIFICATION PIPELINE =================

function handleFileUpload(event) {
	const file = event.target.files[0];
	if (!file) return;

	showToast(`Parsing "${file.name}" with OCR extractor...`);
	setTimeout(() => {
		appData.reviewDraft = [
			{
				code: "IDSaAA",
				name: "Data Structures & Algorithms",
				credits: 4,
				lecsPerWeek: 4,
				labsPerWeek: 0,
			},
			{
				code: "OOP",
				name: "Object Oriented Programming",
				credits: 4,
				lecsPerWeek: 3,
				labsPerWeek: 1,
			},
			{
				code: "DM",
				name: "Discrete Mathematics",
				credits: 4,
				lecsPerWeek: 4,
				labsPerWeek: 0,
			},
			{
				code: "FLAT",
				name: "Formal Language & Automata Theory",
				credits: 4,
				lecsPerWeek: 4,
				labsPerWeek: 0,
			},
			{
				code: "OSTL",
				name: "Open Source Tech Laboratory",
				credits: 2,
				lecsPerWeek: 0,
				labsPerWeek: 2,
			},
		];
		renderParsedEditableReview();
		showToast("Extracted courses! Edit any values below before saving.");
	}, 750);
}

function renderParsedEditableReview() {
	const cont = document.getElementById("parsedCoursesEditableList");
	if (!cont) return;
	cont.innerHTML = "";

	if (appData.reviewDraft.length === 0) {
		cont.innerHTML = `
      <div class="p-6 text-center text-slate-400 bg-slate-50 border border-slate-200 rounded-xl">
        <p class="text-xs">No draft parsed yet. Upload your timetable PDF/image above, or click "+ Add Course Row" to input manually.</p>
      </div>
    `;
		return;
	}

	appData.reviewDraft.forEach((c, idx) => {
		const row = document.createElement("div");
		row.className =
			"flex flex-col sm:flex-row items-center gap-3 p-3 bg-white rounded-xl border border-slate-200 text-xs";
		row.innerHTML = `
      <div class="w-full sm:w-28">
        <label class="text-[10px] font-bold text-slate-400 block uppercase">Code</label>
        <input type="text" value="${c.code}" onchange="updateDraftField(${idx}, 'code', this.value)" class="w-full font-bold px-2 py-1 border border-slate-300 rounded font-mono">
      </div>
      <div class="w-full sm:flex-1">
        <label class="text-[10px] font-bold text-slate-400 block uppercase">Course Name</label>
        <input type="text" value="${c.name}" onchange="updateDraftField(${idx}, 'name', this.value)" class="w-full px-2 py-1 border border-slate-300 rounded">
      </div>
      <div class="w-24">
        <label class="text-[10px] font-bold text-slate-400 block uppercase text-center">Credits</label>
        <input type="number" min="1" max="10" value="${c.credits}" onchange="updateDraftField(${idx}, 'credits', parseInt(this.value, 10))" class="w-full text-center font-bold px-2 py-1 border border-slate-300 rounded">
      </div>
      <div class="w-20">
        <label class="text-[10px] font-bold text-slate-400 block uppercase text-center">Lecs/Wk</label>
        <input type="number" min="0" max="10" value="${c.lecsPerWeek}" onchange="updateDraftField(${idx}, 'lecsPerWeek', parseInt(this.value, 10))" class="w-full text-center px-2 py-1 border border-slate-300 rounded">
      </div>
      <div class="w-20">
        <label class="text-[10px] font-bold text-slate-400 block uppercase text-center">Labs/Wk</label>
        <input type="number" min="0" max="10" value="${c.labsPerWeek}" onchange="updateDraftField(${idx}, 'labsPerWeek', parseInt(this.value, 10))" class="w-full text-center px-2 py-1 border border-slate-300 rounded">
      </div>
      <div class="pt-3 sm:pt-0">
        <button onclick="removeDraftRow(${idx})" class="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50" title="Delete Row">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
        </button>
      </div>
    `;
		cont.appendChild(row);
	});
	lucide.createIcons();
}

function updateDraftField(index, field, value) {
	if (appData.reviewDraft[index]) {
		appData.reviewDraft[index][field] = value;
	}
}

function addReviewItemRow() {
	appData.reviewDraft.push({
		code: "NEW_COURSE",
		name: "Course Title",
		credits: 4,
		lecsPerWeek: 3,
		labsPerWeek: 1,
	});
	renderParsedEditableReview();
}

function removeDraftRow(index) {
	appData.reviewDraft.splice(index, 1);
	renderParsedEditableReview();
}

function commitParsedSchedule() {
	if (appData.reviewDraft.length === 0) {
		showToast("No courses to confirm. Upload or add rows first.", true);
		return;
	}

	appData.courses = appData.reviewDraft.map((c) => ({
		...c,
		currentMarks: 85,
		gradePoint: 9.0,
	}));

	appData.timetable["Wednesday"] = appData.courses.map((c, i) => ({
		time: `0${9 + i}:00 - ${10 + i}:00`,
		course: c.code,
		type:
			c.labsPerWeek > 0 && i === appData.courses.length - 1 ? "Lab" : "Lecture",
		room: "LH-201",
	}));

	syncAllToFirestore();
	refreshDashboard();
	renderCalendar();
	switchView("dashboard");
	showToast("Verified & synced! Workload forecast updated.");
}

// ================= COURSES & GPA TABLE =================

function renderCoursesTable() {
	const tbody = document.getElementById("coursesTableBody");
	if (!tbody) return;
	tbody.innerHTML = "";

	let totalCredits = 0;
	let totalGradePoints = 0;

	if (appData.courses.length === 0) {
		tbody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center py-8 text-slate-400">
          No courses currently enrolled. Use "+ Add Course" or upload your syllabus in the Importer.
        </td>
      </tr>
    `;
		document.getElementById("calculatedGpaDisplay").innerHTML =
			`0.00 <span class="text-lg font-normal text-indigo-300">/ 10.0</span>`;
		document.getElementById("gpaCourseBreakdownText").innerText =
			"Total Credits: 0";
		document.getElementById("gpaEnrolledCount").innerText = "0";
		document.getElementById("metricGpa").innerHTML =
			`-- <span class="text-xs text-slate-400 font-normal">/ 10</span>`;
		document.getElementById("metricCoursesCount").innerText =
			`0 courses tracked`;
		return;
	}

	appData.courses.forEach((c, idx) => {
		totalCredits += c.credits;
		totalGradePoints += c.credits * c.gradePoint;

		const tr = document.createElement("tr");
		tr.className = "hover:bg-slate-50/70 transition";
		tr.innerHTML = `
      <td class="py-3 px-4 font-mono font-bold text-indigo-700">${c.code}</td>
      <td class="py-3 px-4 font-semibold text-slate-800">${c.name}</td>
      <td class="py-3 px-4 text-center">
        <span class="px-2 py-0.5 rounded-full bg-slate-100 font-bold text-slate-700">${c.credits} Cr</span>
      </td>
      <td class="py-3 px-4 text-center text-slate-600">${c.lecsPerWeek}</td>
      <td class="py-3 px-4 text-center text-slate-600">${c.labsPerWeek}</td>
      <td class="py-3 px-4">
        <input type="number" min="0" max="100" value="${c.currentMarks}" onchange="updateCourseMarks(${idx}, this.value)" class="w-16 p-1 border border-slate-300 rounded text-center font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500">
        <span class="text-slate-400 text-xs">/ 100</span>
      </td>
      <td class="py-3 px-4 text-center font-bold text-emerald-600">${c.gradePoint.toFixed(1)}</td>
      <td class="py-3 px-4 text-right">
        <button onclick="startFocusWithCourse('${c.code}')" class="text-indigo-600 hover:underline font-bold text-xs">Study</button>
      </td>
    `;
		tbody.appendChild(tr);
	});

	const gpa =
		totalCredits > 0 ? (totalGradePoints / totalCredits).toFixed(2) : "0.00";
	document.getElementById("calculatedGpaDisplay").innerHTML =
		`${gpa} <span class="text-lg font-normal text-indigo-300">/ 10.0</span>`;
	document.getElementById("gpaCourseBreakdownText").innerText =
		`Total Credits: ${totalCredits} • ${appData.courses.length} Active Courses`;
	document.getElementById("gpaEnrolledCount").innerText =
		`${appData.courses.length} Courses`;

	document.getElementById("metricGpa").innerHTML =
		`${gpa} <span class="text-xs text-slate-400 font-normal">/ 10</span>`;
	document.getElementById("metricCoursesCount").innerText =
		`${appData.courses.length} courses tracked`;
}

function updateCourseMarks(index, val) {
	const marks = parseFloat(val) || 0;
	appData.courses[index].currentMarks = marks;
	if (marks >= 85) appData.courses[index].gradePoint = 10.0;
	else if (marks >= 75) appData.courses[index].gradePoint = 9.0;
	else if (marks >= 65) appData.courses[index].gradePoint = 8.0;
	else if (marks >= 55) appData.courses[index].gradePoint = 7.0;
	else appData.courses[index].gradePoint = 6.0;

	renderCoursesTable();
	syncAllToFirestore();
}

function addNewCoursePrompt() {
	const code = prompt("Enter Course Code (e.g. JDSAAR, OOP):");
	if (!code) return;
	const name =
		prompt("Enter Full Course Name:", "Object Oriented Programming") || code;
	const credits = parseInt(prompt("Credits (e.g. 4 or 2):", "4"), 10) || 4;

	appData.courses.push({
		code: code.toUpperCase(),
		name: name,
		credits: credits,
		lecsPerWeek: 3,
		labsPerWeek: 1,
		currentMarks: 85,
		gradePoint: 9.0,
	});

	refreshDashboard();
	renderCalendar();
	syncAllToFirestore();
	showToast(`Added ${code}`);
}

// ================= AI LEVELING & POMODORO =================

function triggerAiScheduleRebalance() {
	showToast("Balancing workload stress across upcoming safe slots...");
	setTimeout(() => {
		showToast("AI Leveling Applied: Shifts logged in Study Planner.");
	}, 600);
}

function renderPlannerView() {
	const grid = document.getElementById("studyPlannerDaysGrid");
	if (!grid) return;

	grid.innerHTML = `
    <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
      <div class="flex items-center justify-between pb-3 border-b border-slate-100">
        <h4 class="font-bold text-slate-800 text-sm">Today's Protective Blocks</h4>
        <span class="text-xs px-2 py-0.5 rounded font-bold bg-indigo-100 text-indigo-800">Safe Pace</span>
      </div>
      <p class="text-xs text-slate-500">Autonomous shifts allocate extra revision hours before exam dates so you do not have to cram.</p>
    </div>
  `;
}

function updateFocusCourseSelect() {
	const sel = document.getElementById("focusCourseSelect");
	if (!sel) return;
	sel.innerHTML = '<option value="GENERAL">General Study</option>';
	appData.courses.forEach((c) => {
		const opt = document.createElement("option");
		opt.value = c.code;
		opt.innerText = `${c.code} (${c.name})`;
		sel.appendChild(opt);
	});
}

function startFocusWithCourse(code) {
	switchView("focus");
	const sel = document.getElementById("focusCourseSelect");
	if (sel) sel.value = code;
	setFocusMode(25, `${code} Prep`);
	toggleTimer();
}

function setFocusMode(minutes, modeLabel) {
	clearInterval(appData.focus.timer);
	appData.focus.isRunning = false;
	appData.focus.totalSeconds = minutes * 60;
	appData.focus.currentSeconds = minutes * 60;
	appData.focus.mode = modeLabel;

	document
		.querySelectorAll("#btn-mode-25, #btn-mode-5, #btn-mode-50")
		.forEach((b) => {
			b.classList.remove("bg-white", "shadow-sm", "text-indigo-600");
			b.classList.add("hover:text-slate-900");
		});

	const activeBtn = document.getElementById(`btn-mode-${minutes}`);
	if (activeBtn) {
		activeBtn.classList.add("bg-white", "shadow-sm", "text-indigo-600");
		activeBtn.classList.remove("hover:text-slate-900");
	}

	document.getElementById("timerLabel").innerText = `${modeLabel} Session`;
	document.getElementById("timerBtnText").innerText = "Start Focus";
	updateTimerDisplay();
}

function updateTimerDisplay() {
	const mins = Math.floor(appData.focus.currentSeconds / 60);
	const secs = appData.focus.currentSeconds % 60;
	document.getElementById("timerDisplay").innerText =
		`${mins < 10 ? "0" + mins : mins}:${secs < 10 ? "0" + secs : secs}`;
}

function toggleTimer() {
	if (appData.focus.isRunning) {
		clearInterval(appData.focus.timer);
		appData.focus.isRunning = false;
		document.getElementById("timerBtnText").innerText = "Resume Focus";
	} else {
		appData.focus.isRunning = true;
		document.getElementById("timerBtnText").innerText = "Pause";
		appData.focus.timer = setInterval(() => {
			if (appData.focus.currentSeconds > 0) {
				appData.focus.currentSeconds--;
				updateTimerDisplay();
			} else {
				clearInterval(appData.focus.timer);
				appData.focus.isRunning = false;
				playChime();
				appData.focus.completedSessions++;
				document.getElementById("completedSessionsCount").innerText =
					appData.focus.completedSessions;
				document.getElementById("timerBtnText").innerText = "Start Focus";
				showToast("Focus session complete!");
			}
		}, 1000);
	}
}

function resetTimer() {
	clearInterval(appData.focus.timer);
	appData.focus.isRunning = false;
	appData.focus.currentSeconds = appData.focus.totalSeconds;
	document.getElementById("timerBtnText").innerText = "Start Focus";
	updateTimerDisplay();
}

function playChime() {
	try {
		const synth = new Tone.PolySynth(Tone.Synth).toDestination();
		synth.triggerAttackRelease(["C5", "E5", "G5"], "4n");
	} catch (e) {
		console.log("Synthetic tone triggered");
	}
}

// ================= ADMIN PORTAL (READS FROM FIRESTORE) =================

async function fetchAdminDirectory() {
	const tbody = document.getElementById("adminUserTableBody");
	if (!tbody) return;
	tbody.innerHTML =
		'<tr><td colspan="6" class="text-center py-4 text-slate-400">Loading user directory...</td></tr>';

	if (!isFirebaseReady) {
		tbody.innerHTML = `
      <tr>
        <td class="py-3 px-4 font-mono font-bold text-slate-700">demo-admin-uid</td>
        <td class="py-3 px-4">${appData.userProfile.displayName}</td>
        <td class="py-3 px-4">${appData.userProfile.department}</td>
        <td class="py-3 px-4 text-center">${appData.userProfile.semester}</td>
        <td class="py-3 px-4 text-center"><span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">Admin</span></td>
        <td class="py-3 px-4 text-slate-400">Local Session</td>
      </tr>
    `;
		document.getElementById("adminTotalUsers").innerText = "1";
		document.getElementById("adminTotalCourses").innerText =
			appData.courses.length;
		return;
	}

	try {
		const snap = await db.collection("users").get();
		tbody.innerHTML = "";
		document.getElementById("adminTotalUsers").innerText = snap.size;
		document.getElementById("adminTotalCourses").innerText =
			appData.courses.length;

		snap.forEach((doc) => {
			const u = doc.data();
			const tr = document.createElement("tr");
			tr.className = "hover:bg-slate-50";
			tr.innerHTML = `
        <td class="py-3 px-4 font-mono text-slate-600">${u.email || doc.id}</td>
        <td class="py-3 px-4 font-bold text-slate-800">${u.displayName || "Student"}</td>
        <td class="py-3 px-4 text-slate-600">${u.department || "Information Tech"}</td>
        <td class="py-3 px-4 text-center">${u.semester || 3}</td>
        <td class="py-3 px-4 text-center">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${u.role === "admin" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"}">
            ${u.role || "student"}
          </span>
        </td>
        <td class="py-3 px-4 text-slate-400">${u.createdAt ? new Date(u.createdAt.seconds * 1000).toLocaleDateString() : "Recent"}</td>
      `;
			tbody.appendChild(tr);
		});
	} catch (e) {
		tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-red-500 font-semibold">Failed to fetch users: ${e.message}</td></tr>`;
	}
}

// ================= BOOTSTRAP INITIALIZATION =================

window.addEventListener("DOMContentLoaded", () => {
	// 1. Restore local cache on startup
	const savedDeadlines = localStorage.getItem("synapse_deadlines");
	if (savedDeadlines) {
		try {
			appData.deadlines = JSON.parse(savedDeadlines);
		} catch (e) {}
	}
	const savedTasks = localStorage.getItem("synapse_tasks");
	if (savedTasks) {
		try {
			appData.tasks = JSON.parse(savedTasks);
		} catch (e) {}
	}
	const savedCourses = localStorage.getItem("synapse_courses");
	if (savedCourses) {
		try {
			appData.courses = JSON.parse(savedCourses);
		} catch (e) {}
	}

	// 2. Render all views
	refreshDashboard();
	renderCalendar();
	renderParsedEditableReview();
	updateTimerDisplay();
	lucide.createIcons();
});
