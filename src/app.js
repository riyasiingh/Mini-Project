/* =====================================================================
   SYNAPSELOAD CENTRAL ENGINE (app.js)
   User-driven academic data + verified extraction + semester archiving
   ===================================================================== */

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

if (typeof pdfjsLib !== "undefined" && pdfjsLib.GlobalWorkerOptions) {
	pdfjsLib.GlobalWorkerOptions.workerSrc =
		"https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

const systemDate = new Date();

const appData = {
	currentUser: null,

	userProfile: {
		displayName: "",
		department: "",
		semester: null,
		saturdayRule: null,
		role: "student",
		dailyStudyHours: null,
	},

	courses: [],
	timetable: {},
	deadlines: [],
	tasks: [],

	history: {
		tasks: [],
		deadlines: [],
		semesters: [],
	},

	reviewDraft: [],
	reviewTimetableDraft: [],
	reviewEventsDraft: [],
	reviewSource: null,

	focus: {
		timer: null,
		totalSeconds: 25 * 60,
		currentSeconds: 25 * 60,
		isRunning: false,
		mode: "Pomodoro",
		completedSessions: 0,
	},

	currentMonth: systemDate.getMonth(),
	currentYear: systemDate.getFullYear(),
};

/* ================================================================
   USER-SUPPLIED CALENDAR
   No government/college/festival data is hardcoded.
   ================================================================ */

const indianCalendarData = {
	customOverrides: {},
};

function getDayFestivalInfo(dateStr) {
	return indianCalendarData.customOverrides[dateStr] || null;
}

/* ================================================================
   AUTHENTICATION
   ================================================================ */

let currentAuthMode = "signin";

function setAuthMode(mode) {
	currentAuthMode = mode;

	const isSignUp = mode === "signup";

	const title = document.getElementById("authTitle");
	const submit = document.getElementById("authSubmitBtn");
	const signInTab = document.getElementById("authTabSignIn");
	const signUpTab = document.getElementById("authTabSignUp");
	const nameField = document.getElementById("authNameField");
	const metaFields = document.getElementById("authMetaFields");

	if (title) {
		title.innerText = isSignUp ? "Create Account" : "Sign In";
	}

	if (submit) {
		submit.innerText = isSignUp ? "Sign Up & Sync" : "Sign In";
	}

	if (signInTab) {
		signInTab.className = !isSignUp
			? "flex-1 py-2 rounded-lg bg-white shadow-sm text-indigo-600 font-bold"
			: "flex-1 py-2 rounded-lg hover:text-slate-900";
	}

	if (signUpTab) {
		signUpTab.className = isSignUp
			? "flex-1 py-2 rounded-lg bg-white shadow-sm text-indigo-600 font-bold"
			: "flex-1 py-2 rounded-lg hover:text-slate-900";
	}

	if (nameField) {
		nameField.classList.toggle("hidden", !isSignUp);
	}

	if (metaFields) {
		metaFields.classList.toggle("hidden", !isSignUp);
	}
}

async function handleAuthSubmit(e) {
	e.preventDefault();

	const emailInput = document.getElementById("authEmailInput");
	const passwordInput = document.getElementById("authPasswordInput");

	const email = emailInput ? emailInput.value.trim() : "";
	const password = passwordInput ? passwordInput.value.trim() : "";

	if (!email || !password) {
		showToast("Enter your email and password.", true);
		return;
	}

	if (!isFirebaseReady) {
		setupLocalSession("");
		return;
	}

	try {
		if (currentAuthMode === "signup") {
			const nameInput = document.getElementById("authNameInput");
			const branchInput = document.getElementById("authBranchInput");
			const semesterInput = document.getElementById("authSemesterInput");

			const name = nameInput ? nameInput.value.trim() : "";
			const branch = branchInput ? branchInput.value.trim() : "";
			const sem = semesterInput ? parseInt(semesterInput.value, 10) : NaN;

			if (!name || !branch || !Number.isInteger(sem) || sem < 1 || sem > 12) {
				showToast("Enter your name, department and valid semester.", true);
				return;
			}

			const cred = await auth.createUserWithEmailAndPassword(email, password);

			const profile = {
				uid: cred.user.uid,
				email: email,
				displayName: name,
				department: branch,
				semester: sem,
				role: "student",
				saturdayRule: null,
				dailyStudyHours: null,
				createdAt: firebase.firestore.FieldValue.serverTimestamp(),
			};

			await db.collection("users").doc(cred.user.uid).set(profile);

			appData.userProfile = {
				...appData.userProfile,
				...profile,
			};

			showToast(`Welcome ${name}!`);
		} else {
			await auth.signInWithEmailAndPassword(email, password);
			showToast("Signed in successfully!");
		}

		const modal = document.getElementById("authModal");

		if (modal) {
			modal.classList.add("hidden");
		}
	} catch (err) {
		console.error(err);
		showToast(err.message || "Authentication failed.", true);
	}
}

function continueAsGuest() {
	setupLocalSession("");
}

function setupLocalSession() {
	appData.userProfile.displayName = "";
	appData.userProfile.role = "student";

	updateUserDisplayUI();

	const modal = document.getElementById("authModal");

	if (modal) {
		modal.classList.add("hidden");
	}

	refreshDashboard();
	renderCalendar();
}

function handleSignOutOrOpenAuth() {
	if (isFirebaseReady && auth && auth.currentUser) {
		auth.signOut().then(() => {
			const modal = document.getElementById("authModal");

			if (modal) {
				modal.classList.remove("hidden");
			}

			resetToEmptyState();
			showToast("Signed out.");
		});
	} else {
		const modal = document.getElementById("authModal");

		if (modal) {
			modal.classList.remove("hidden");
		}
	}
}

if (isFirebaseReady && auth) {
	auth.onAuthStateChanged(async (user) => {
		if (user) {
			appData.currentUser = user;

			const modal = document.getElementById("authModal");

			if (modal) {
				modal.classList.add("hidden");
			}

			try {
				const userDoc = await db.collection("users").doc(user.uid).get();

				if (userDoc.exists) {
					appData.userProfile = {
						...appData.userProfile,
						...userDoc.data(),
					};
				}

				await loadUserDataFromFirestore(user.uid);

				updateUserDisplayUI();
				refreshDashboard();
				renderCalendar();
			} catch (error) {
				console.error("User loading error:", error);
				showToast("Could not load your account data.", true);
			}
		} else {
			const modal = document.getElementById("authModal");

			if (modal) {
				modal.classList.remove("hidden");
			}
		}
	});
}

function updateUserDisplayUI() {
	const name = appData.userProfile.displayName || "Student";
	const role = appData.userProfile.role || "student";

	const nameLabel = document.getElementById("userNameLabel");
	const avatar = document.getElementById("userAvatarBadge");
	const roleText = document.getElementById("userRoleSubtext");

	if (nameLabel) {
		nameLabel.innerText = name;
	}

	if (avatar) {
		avatar.innerText = name.substring(0, 2).toUpperCase();
	}

	if (roleText) {
		roleText.innerText = appData.userProfile.semester
			? `${role.toUpperCase()} • Sem ${appData.userProfile.semester}`
			: role.toUpperCase();
	}

	const adminNav = document.getElementById("nav-admin");

	if (adminNav) {
		if (role === "admin") {
			adminNav.classList.remove("hidden");
		} else {
			adminNav.classList.add("hidden");
		}
	}
}

/* ================================================================
   FIRESTORE
   ================================================================ */

async function loadUserDataFromFirestore(uid) {
	if (!isFirebaseReady || !uid) {
		return;
	}

	try {
		const coursesSnap = await db
			.collection("users")
			.doc(uid)
			.collection("courses")
			.get();

		appData.courses = coursesSnap.empty
			? []
			: coursesSnap.docs.map((doc) => ({
					id: doc.id,
					...doc.data(),
				}));

		const deadlineSnap = await db
			.collection("users")
			.doc(uid)
			.collection("deadlines")
			.get();

		appData.deadlines = deadlineSnap.empty
			? []
			: deadlineSnap.docs.map((doc) => ({
					id: doc.id,
					...doc.data(),
				}));

		const tasksSnap = await db
			.collection("users")
			.doc(uid)
			.collection("tasks")
			.get();

		appData.tasks = tasksSnap.empty
			? []
			: tasksSnap.docs.map((doc) => ({
					id: doc.id,
					...doc.data(),
				}));

		try {
			const savedTimetable = localStorage.getItem("synapse_timetable");

			if (savedTimetable) {
				appData.timetable = JSON.parse(savedTimetable);
			}

			const savedProfile = localStorage.getItem("synapse_profile");

			if (savedProfile) {
				appData.userProfile = {
					...appData.userProfile,
					...JSON.parse(savedProfile),
				};
			}

			const savedHistory = localStorage.getItem("synapse_history");

			if (savedHistory) {
				appData.history = {
					...appData.history,
					...JSON.parse(savedHistory),
				};
			}
		} catch (e) {
			console.warn("Local restore failed:", e);
		}

		localStorage.setItem("synapse_courses", JSON.stringify(appData.courses));
		localStorage.setItem("synapse_deadlines", JSON.stringify(appData.deadlines));
		localStorage.setItem("synapse_tasks", JSON.stringify(appData.tasks));

		refreshDashboard();
		renderCalendar();
	} catch (e) {
		console.error("Firestore sync error:", e);
	}
}

async function syncAllToFirestore() {
	try {
		localStorage.setItem("synapse_courses", JSON.stringify(appData.courses));
		localStorage.setItem("synapse_deadlines", JSON.stringify(appData.deadlines));
		localStorage.setItem("synapse_tasks", JSON.stringify(appData.tasks));
		localStorage.setItem("synapse_timetable", JSON.stringify(appData.timetable));
		localStorage.setItem("synapse_profile", JSON.stringify(appData.userProfile));
		localStorage.setItem("synapse_history", JSON.stringify(appData.history));
	} catch (e) {
		console.warn("LocalStorage cache failed:", e);
	}

	if (!isFirebaseReady || !auth || !auth.currentUser) {
		return;
	}

	const uid = auth.currentUser.uid;

	try {
		const batch = db.batch();

		for (const c of appData.courses) {
			const docRef = db
				.collection("users")
				.doc(uid)
				.collection("courses")
				.doc(c.code);

			batch.set(docRef, c);
		}

		for (const d of appData.deadlines) {
			const docRef = db
				.collection("users")
				.doc(uid)
				.collection("deadlines")
				.doc(String(d.id));

			batch.set(docRef, d);
		}

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

async function clearAllUserData() {
	if (
		!confirm(
			"Are you sure you want to completely erase all stored courses, deadlines, and tasks?",
		)
	) {
		return;
	}

	if (isFirebaseReady && auth && auth.currentUser) {
		const uid = auth.currentUser.uid;

		try {
			const batch = db.batch();

			const cSnap = await db
				.collection("users")
				.doc(uid)
				.collection("courses")
				.get();

			cSnap.forEach((doc) => batch.delete(doc.ref));

			const dSnap = await db
				.collection("users")
				.doc(uid)
				.collection("deadlines")
				.get();

			dSnap.forEach((doc) => batch.delete(doc.ref));

			const tSnap = await db
				.collection("users")
				.doc(uid)
				.collection("tasks")
				.get();

			tSnap.forEach((doc) => batch.delete(doc.ref));

			await batch.commit();
		} catch (e) {
			console.error("Cloud purge failed", e);
		}
	}

	resetToEmptyState();

	showToast("All data purged cleanly!");
}

function resetToEmptyState() {
	appData.courses = [];
	appData.timetable = {};
	appData.deadlines = [];
	appData.tasks = [];
	appData.reviewDraft = [];
	appData.reviewTimetableDraft = [];
	appData.reviewEventsDraft = [];

	localStorage.removeItem("synapse_courses");
	localStorage.removeItem("synapse_deadlines");
	localStorage.removeItem("synapse_tasks");
	localStorage.removeItem("synapse_timetable");

	refreshDashboard();
	renderCalendar();
	renderParsedEditableReview();
}

/* ================================================================
   VIEW SWITCHER (All-White Light Theme Navigation)
   ================================================================ */

function switchView(viewName) {
	document
		.querySelectorAll(".view-panel")
		.forEach((panel) => panel.classList.add("hidden"));

	document.querySelectorAll(".nav-item").forEach((item) => {
		item.classList.remove(
			"bg-indigo-50",
			"text-indigo-700",
			"border",
			"border-indigo-100",
			"font-semibold",
			"shadow-xs",
		);
		if (item.id !== "nav-importer" && item.id !== "nav-admin") {
			item.classList.add(
				"hover:bg-slate-50",
				"text-slate-600",
				"hover:text-slate-900",
				"font-medium",
			);
		}
	});

	const activePanel = document.getElementById("view-" + viewName);

	if (activePanel) {
		activePanel.classList.remove("hidden");
	}

	const activeNav = document.getElementById("nav-" + viewName);

	if (activeNav) {
		activeNav.classList.remove(
			"hover:bg-slate-50",
			"text-slate-600",
			"hover:text-slate-900",
			"font-medium",
		);
		activeNav.classList.add(
			"bg-indigo-50",
			"text-indigo-700",
			"border",
			"border-indigo-100",
			"font-semibold",
			"shadow-xs",
		);
	}

	const sidebar = document.getElementById("sidebarNav");

	if (sidebar) {
		sidebar.classList.add("-translate-x-full");
	}

	if (viewName === "calendar") {
		renderCalendar();
	}

	if (viewName === "collision") {
		renderCollisionView();
	}

	if (viewName === "courses") {
		renderCoursesTable();
	}

	if (viewName === "history") {
		renderHistoryView();
	}

	if (viewName === "planner") {
		renderPlannerView();
	}

	if (viewName === "importer") {
		renderParsedEditableReview();
	}

	if (viewName === "admin") {
		fetchAdminDirectory();
	}

	if (viewName === "dashboard") {
		refreshDashboard();
	}

	if (viewName === "profile") {
		populateProfileView();
	}
}

function toggleMobileNav() {
	const sidebar = document.getElementById("sidebarNav");

	if (sidebar) {
		sidebar.classList.toggle("-translate-x-full");
	}
}

function showToast(message, isAlert = false) {
	const toast = document.getElementById("toast");
	const toastMsg = document.getElementById("toastMessage");
	const toastIcon = document.getElementById("toastIcon");

	if (!toast || !toastMsg) {
		console.log(message);
		return;
	}

	toastMsg.innerText = message;

	if (isAlert) {
		if (toastIcon) {
			toastIcon.setAttribute("data-lucide", "alert-circle");
			toastIcon.className = "w-4 h-4 text-red-600";
		}
		toast.classList.add("border-red-300", "bg-red-50", "text-red-900");
		toast.classList.remove("border-slate-200", "bg-white", "text-slate-800");
	} else {
		if (toastIcon) {
			toastIcon.setAttribute("data-lucide", "check-circle-2");
			toastIcon.className = "w-4 h-4 text-indigo-600";
		}
		toast.classList.remove("border-red-300", "bg-red-50", "text-red-900");
		toast.classList.add("border-slate-200", "bg-white", "text-slate-800");
	}

	if (typeof lucide !== "undefined") {
		lucide.createIcons();
	}

	toast.classList.remove("translate-y-20", "opacity-0");

	setTimeout(() => {
		toast.classList.add("translate-y-20", "opacity-0");
	}, 3200);
}

/* ================================================================
   SATURDAY POLICY
   ================================================================ */

function toggleSaturdayHoliday(isChecked) {
	appData.userProfile.saturdayRule = isChecked ? "alternate" : "all_working";

	const label = document.getElementById("satStatusLabel");

	if (label) {
		label.innerText = isChecked ? "Alternate Off" : "Working";
	}

	const select = document.getElementById("satSelectRule");

	if (select) {
		select.value = isChecked ? "alternate" : "all_working";
	}

	showToast("Saturday policy updated");

	renderCalendar();
	refreshDashboard();
}

function updateSaturdayRule(val) {
	appData.userProfile.saturdayRule = val;

	const toggle = document.getElementById("satHolidayToggle");

	if (toggle) {
		toggle.checked = val !== "all_working";
	}

	const label = document.getElementById("satStatusLabel");

	if (label) {
		label.innerText =
			val === "all_off"
				? "All Off"
				: val === "alternate"
					? "Alternate Off"
					: "Working";
	}

	showToast("Saturday policy updated");

	renderCalendar();
	refreshDashboard();
}

/* ================================================================
   PROFILE, SEMESTER & ARCHIVE RESTORE
   ================================================================ */

function populateProfileView() {
	const p = appData.userProfile;

	const setValue = (id, value) => {
		const el = document.getElementById(id);

		if (el) {
			el.value = value ?? "";
		}
	};

	setValue("profileNameInput", p.displayName);
	setValue("profileDepartmentInput", p.department);
	setValue("profileSemesterInput", p.semester);
	setValue("profileStudyHoursInput", p.dailyStudyHours);
	setValue("profileSaturdayInput", p.saturdayRule);

	renderArchivedSemesters();
}

async function saveUserProfile() {
	const name = document.getElementById("profileNameInput")?.value.trim();
	const department = document
		.getElementById("profileDepartmentInput")
		?.value.trim();
	const semester = Number(
		document.getElementById("profileSemesterInput")?.value,
	);
	const dailyStudyHours = Number(
		document.getElementById("profileStudyHoursInput")?.value,
	);
	const saturdayRule = document.getElementById("profileSaturdayInput")?.value;

	if (
		!name ||
		!department ||
		!Number.isInteger(semester) ||
		semester < 1 ||
		semester > 12 ||
		!Number.isFinite(dailyStudyHours) ||
		dailyStudyHours <= 0 ||
		!saturdayRule
	) {
		showToast("Complete all academic profile fields before saving.", true);
		return;
	}

	appData.userProfile = {
		...appData.userProfile,
		displayName: name,
		department: department,
		semester: semester,
		dailyStudyHours: dailyStudyHours,
		saturdayRule: saturdayRule,
	};

	if (isFirebaseReady && auth && auth.currentUser) {
		try {
			await db
				.collection("users")
				.doc(auth.currentUser.uid)
				.set(appData.userProfile, { merge: true });
		} catch (e) {
			console.error(e);
		}
	}

	localStorage.setItem("synapse_profile", JSON.stringify(appData.userProfile));

	updateUserDisplayUI();
	renderCalendar();
	refreshDashboard();

	showToast("Academic profile saved.");
}

async function startNewSemester() {
	if (!appData.userProfile.semester) {
		showToast("Save your current academic profile first.", true);
		return;
	}

	const archiveKey = `synapse_archive_${Date.now()}`;
	const archivedAt = new Date().toISOString();

	const archive = {
		profile: {
			...appData.userProfile,
		},
		courses: appData.courses,
		timetable: appData.timetable,
		deadlines: appData.deadlines,
		tasks: appData.tasks,
		archivedAt,
	};

	localStorage.setItem(archiveKey, JSON.stringify(archive));

	const semStats = computeCourseListGpa(appData.courses);
	appData.history.semesters.unshift({
		id: archiveKey,
		profile: { ...appData.userProfile },
		courses: [...appData.courses],
		deadlines: [...appData.deadlines],
		tasks: [...appData.tasks],
		gpa: semStats.gpa,
		totalCredits: semStats.totalCredits,
		archivedAt,
	});
	localStorage.setItem("synapse_history", JSON.stringify(appData.history));

	await clearAllUserData();

	appData.userProfile = {
		...appData.userProfile,
		semester: Number(appData.userProfile.semester) + 1,
		dailyStudyHours: null,
		saturdayRule: null,
	};

	populateProfileView();
	updateUserDisplayUI();
	syncAllToFirestore();

	showToast(
		`Semester ${appData.userProfile.semester} created. Previous semester saved in History & Archive.`,
	);
}

function renderArchivedSemesters() {
	const card = document.getElementById("archivedSemestersCard");
	const list = document.getElementById("archivedSemestersList");
	if (!card || !list) return;

	const archives = [];
	for (let i = 0; i < localStorage.length; i++) {
		const key = localStorage.key(i);
		if (key && key.startsWith("synapse_archive_")) {
			try {
				const parsed = JSON.parse(localStorage.getItem(key));
				if (parsed && parsed.profile) {
					archives.push({ key, ...parsed });
				}
			} catch (e) {
				console.warn("Invalid archive entry:", key);
			}
		}
	}

	archives.sort((a, b) => new Date(b.archivedAt) - new Date(a.archivedAt));

	if (archives.length === 0) {
		card.classList.add("hidden");
		return;
	}

	card.classList.remove("hidden");
	list.innerHTML = "";

	archives.forEach((arch) => {
		const semLabel = arch.profile.semester
			? `Semester ${arch.profile.semester}`
			: "Previous Semester";
		const courseCount = Array.isArray(arch.courses) ? arch.courses.length : 0;
		const dateText = arch.archivedAt
			? new Date(arch.archivedAt).toLocaleString()
			: "";

		const row = document.createElement("div");
		row.className =
			"p-4 rounded-2xl border border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm";
		row.innerHTML = `
			<div>
				<div class="font-bold text-slate-800">${escapeHtml(semLabel)} (${courseCount} courses)</div>
				<div class="text-xs text-slate-500">Archived on ${escapeHtml(dateText)}</div>
			</div>
			<div class="flex items-center gap-2">
				<button type="button" onclick="restoreArchivedSemester('${escapeHtml(arch.key)}')" class="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition">
					Restore Semester
				</button>
				<button type="button" onclick="deleteArchivedSemester('${escapeHtml(arch.key)}')" class="px-3 py-2 bg-white border border-slate-200 hover:bg-red-50 hover:text-red-600 text-slate-600 rounded-xl text-xs font-semibold transition">
					Delete
				</button>
			</div>
		`;
		list.appendChild(row);
	});
}

async function restoreArchivedSemester(archiveKey) {
	const raw = localStorage.getItem(archiveKey);
	if (!raw) {
		showToast("Archive snapshot not found.", true);
		return;
	}

	if (
		!confirm(
			"Restore this archived semester? Your current active courses, deadlines, and tasks will be replaced with the saved snapshot.",
		)
	) {
		return;
	}

	try {
		const archive = JSON.parse(raw);

		appData.userProfile = {
			...appData.userProfile,
			...archive.profile,
		};

		appData.courses = Array.isArray(archive.courses) ? archive.courses : [];
		appData.timetable = archive.timetable || {};
		appData.deadlines = Array.isArray(archive.deadlines)
			? archive.deadlines
			: [];
		appData.tasks = Array.isArray(archive.tasks) ? archive.tasks : [];

		if (isFirebaseReady && auth && auth.currentUser) {
			await db
				.collection("users")
				.doc(auth.currentUser.uid)
				.set(appData.userProfile, { merge: true });
		}

		await syncAllToFirestore();

		populateProfileView();
		updateUserDisplayUI();
		refreshDashboard();
		renderCalendar();

		showToast(
			`Restored Semester ${appData.userProfile.semester} successfully!`,
		);
	} catch (e) {
		console.error("Failed to restore semester:", e);
		showToast("Could not restore archived semester.", true);
	}
}

function deleteArchivedSemester(archiveKey) {
	if (!confirm("Permanently delete this archived snapshot?")) return;
	localStorage.removeItem(archiveKey);
	appData.history.semesters = (appData.history.semesters || []).filter(
		(s) => s.id !== archiveKey,
	);
	localStorage.setItem("synapse_history", JSON.stringify(appData.history));
	renderArchivedSemesters();
	renderHistoryView();
	showToast("Archive removed.");
}

/* ================================================================
   UNIFIED ACADEMIC HISTORY & ARCHIVE ENGINE
   ================================================================ */

let historyTaskFilter = "all";

function formatLocalISO(dateObj) {
	const y = dateObj.getFullYear();
	const m = String(dateObj.getMonth() + 1).padStart(2, "0");
	const d = String(dateObj.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

function getTodayISO() {
	return formatLocalISO(new Date());
}

function computeCourseListGpa(courseList) {
	let totalCredits = 0;
	let totalGradePoints = 0;

	(courseList || []).forEach((c) => {
		const credits = Number(c.credits) || 0;
		const gp = Number(c.gradePoint);
		if (
			credits > 0 &&
			c.gradePoint !== null &&
			c.gradePoint !== undefined &&
			c.gradePoint !== "" &&
			Number.isFinite(gp)
		) {
			totalCredits += credits;
			totalGradePoints += credits * gp;
		}
	});

	return {
		totalCredits,
		gpa: totalCredits > 0 ? totalGradePoints / totalCredits : null,
	};
}

function setHistoryTaskFilter(filter) {
	historyTaskFilter = filter;

	["all", "completed", "incomplete"].forEach((key) => {
		const btn = document.getElementById(
			`histFilter${key.charAt(0).toUpperCase() + key.slice(1)}`,
		);
		if (!btn) return;
		if (key === filter) {
			btn.className =
				"px-3 py-1 rounded-lg bg-white text-indigo-600 shadow-sm";
		} else {
			btn.className = "px-3 py-1 rounded-lg text-slate-600";
		}
	});

	renderHistoryView();
}

async function archiveExpiredCurrentItems() {
	const todayISO = getTodayISO();
	let movedTasks = 0;
	let movedDeadlines = 0;

	const remainingTasks = [];
	for (const t of appData.tasks) {
		const isPastDate = isValidISODate(t.date) && t.date < todayISO;
		if (isPastDate) {
			appData.history.tasks.unshift({
				...t,
				archivedAt: new Date().toISOString(),
				semester: appData.userProfile.semester || null,
			});
			await deleteCloudDocument("tasks", t.id);
			movedTasks++;
		} else {
			remainingTasks.push(t);
		}
	}
	appData.tasks = remainingTasks;

	const remainingDeadlines = [];
	for (const d of appData.deadlines) {
		const isPastDate = isValidISODate(d.date) && d.date < todayISO;
		if (isPastDate) {
			appData.history.deadlines.unshift({
				...d,
				archivedAt: new Date().toISOString(),
				semester: appData.userProfile.semester || null,
			});
			await deleteCloudDocument("deadlines", d.id);
			movedDeadlines++;
		} else {
			remainingDeadlines.push(d);
		}
	}
	appData.deadlines = remainingDeadlines;

	if (movedTasks === 0 && movedDeadlines === 0) {
		showToast("No past-due tasks or deadlines to archive right now.");
		return;
	}

	await syncAllToFirestore();
	refreshDashboard();
	renderCalendar();
	renderHistoryView();

	showToast(
		`Archived ${movedTasks} past task(s) and ${movedDeadlines} expired deadline(s).`,
	);
}

function getAllSemesterSnapshots() {
	const map = new Map();

	(appData.history.semesters || []).forEach((s) => {
		if (s && s.id) map.set(s.id, s);
	});

	for (let i = 0; i < localStorage.length; i++) {
		const key = localStorage.key(i);
		if (key && key.startsWith("synapse_archive_") && !map.has(key)) {
			try {
				const parsed = JSON.parse(localStorage.getItem(key));
				if (parsed && parsed.profile) {
					const stats = computeCourseListGpa(parsed.courses);
					map.set(key, {
						id: key,
						profile: parsed.profile,
						courses: parsed.courses || [],
						deadlines: parsed.deadlines || [],
						tasks: parsed.tasks || [],
						gpa: stats.gpa,
						totalCredits: stats.totalCredits,
						archivedAt: parsed.archivedAt,
					});
				}
			} catch (e) {
				console.warn("Skipping invalid archive:", key);
			}
		}
	}

	return Array.from(map.values()).sort(
		(a, b) => new Date(b.archivedAt || 0) - new Date(a.archivedAt || 0),
	);
}

function renderHistoryView() {
	const todayISO = getTodayISO();

	const combinedTasksMap = new Map();
	(appData.history.tasks || []).forEach((t) =>
		combinedTasksMap.set(String(t.id), { ...t, source: "Archived" }),
	);
	(appData.tasks || []).forEach((t) => {
		const isPast = isValidISODate(t.date) && t.date < todayISO;
		if (t.done || isPast) {
			combinedTasksMap.set(String(t.id), {
				...t,
				source: isPast ? "Past Due" : "Active Completed",
			});
		}
	});
	const allHistoryTasks = Array.from(combinedTasksMap.values());

	const combinedDeadlinesMap = new Map();
	(appData.history.deadlines || []).forEach((d) =>
		combinedDeadlinesMap.set(String(d.id), { ...d, source: "Archived" }),
	);
	(appData.deadlines || []).forEach((d) => {
		if (isValidISODate(d.date) && d.date < todayISO) {
			combinedDeadlinesMap.set(String(d.id), { ...d, source: "Expired" });
		}
	});
	const allHistoryDeadlines = Array.from(combinedDeadlinesMap.values());

	const semesters = getAllSemesterSnapshots();

	let cgpaCredits = 0;
	let cgpaPoints = 0;
	const addCoursesToCgpa = (list) => {
		(list || []).forEach((c) => {
			const cr = Number(c.credits) || 0;
			const gp = Number(c.gradePoint);
			if (
				cr > 0 &&
				c.gradePoint !== null &&
				c.gradePoint !== undefined &&
				c.gradePoint !== "" &&
				Number.isFinite(gp)
			) {
				cgpaCredits += cr;
				cgpaPoints += cr * gp;
			}
		});
	};
	semesters.forEach((s) => addCoursesToCgpa(s.courses));
	addCoursesToCgpa(appData.courses);
	const cgpa = cgpaCredits > 0 ? (cgpaPoints / cgpaCredits).toFixed(2) : "--";

	const completedCount = allHistoryTasks.filter((t) => t.done).length;
	const incompleteCount = allHistoryTasks.filter((t) => !t.done).length;

	const setElText = (id, val) => {
		const el = document.getElementById(id);
		if (el) el.innerText = val;
	};
	setElText("histCompletedTasksCount", completedCount);
	setElText("histIncompleteTasksCount", incompleteCount);
	setElText("histPastDeadlinesCount", allHistoryDeadlines.length);
	setElText("histCumulativeGpa", cgpa === "--" ? "--" : `${cgpa} / 10`);

	const semCont = document.getElementById("historySemestersContainer");
	if (semCont) {
		semCont.innerHTML = "";
		if (semesters.length === 0) {
			semCont.innerHTML = `
				<div class="p-6 text-center text-slate-400 border border-dashed border-slate-200 rounded-2xl text-sm">
					No archived semesters yet. When you start a new semester in Profile, your courses, tasks, deadlines, and GPA are saved here.
				</div>
			`;
		} else {
			semesters.forEach((sem) => {
				const semNum = sem.profile?.semester || "?";
				const dept = sem.profile?.department || "Department";
				const gpaText =
					sem.gpa !== null && sem.gpa !== undefined
						? `${Number(sem.gpa).toFixed(2)} / 10`
						: "No grades recorded";
				const courseChips = (sem.courses || [])
					.map(
						(c) => `
						<span class="px-3 py-1 rounded-lg bg-white border border-slate-200 text-xs font-medium text-slate-700">
							<strong class="font-mono text-indigo-700">${escapeHtml(c.code || "")}</strong>
							${escapeHtml(c.name || "")}
							${c.gradePoint !== null && c.gradePoint !== undefined ? `• GP: ${c.gradePoint}` : ""}
						</span>
					`,
					)
					.join("");

				const card = document.createElement("div");
				card.className =
					"p-4 rounded-2xl border border-slate-200 bg-slate-50/70 space-y-3";
				card.innerHTML = `
					<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
						<div>
							<div class="flex items-center gap-2">
								<span class="px-3 py-0.5 rounded-full bg-indigo-600 text-white text-xs font-bold">
									Semester ${escapeHtml(String(semNum))}
								</span>
								<span class="text-sm font-semibold text-slate-700">${escapeHtml(dept)}</span>
							</div>
							<div class="text-xs text-slate-500 mt-1">
								${(sem.courses || []).length} Courses • ${sem.totalCredits || 0} Credits • ${(sem.tasks || []).length} Tasks • ${(sem.deadlines || []).length} Deadlines
							</div>
						</div>
						<div class="flex items-center gap-3">
							<div class="text-right">
								<span class="text-xs uppercase font-bold text-slate-400 block">Semester GPA</span>
								<span class="text-base font-black text-indigo-700">${gpaText}</span>
							</div>
							<button type="button" onclick="restoreArchivedSemester('${escapeHtml(sem.id)}')" class="px-3.5 py-2 bg-white hover:bg-indigo-50 text-indigo-600 border border-indigo-200 rounded-xl text-xs font-bold transition">
								Restore
							</button>
						</div>
					</div>
					${
						courseChips
							? `<div class="flex flex-wrap gap-2 pt-2 border-t border-slate-200/70">${courseChips}</div>`
							: ""
					}
				`;
				semCont.appendChild(card);
			});
		}
	}

	const taskListCont = document.getElementById("historyTasksList");
	if (taskListCont) {
		taskListCont.innerHTML = "";
		const filteredTasks = allHistoryTasks.filter((t) => {
			if (historyTaskFilter === "completed") return Boolean(t.done);
			if (historyTaskFilter === "incomplete") return !t.done;
			return true;
		});

		if (filteredTasks.length === 0) {
			taskListCont.innerHTML = `
				<div class="p-6 text-center text-slate-400 border border-dashed border-slate-200 rounded-2xl text-sm">
					No tasks match this filter.
				</div>
			`;
		} else {
			filteredTasks.forEach((t) => {
				const row = document.createElement("div");
				row.className =
					"p-3.5 rounded-2xl border border-slate-200 bg-slate-50/50 flex items-center justify-between gap-2 text-sm";
				row.innerHTML = `
					<div class="overflow-hidden">
						<div class="font-bold text-slate-800 truncate ${t.done ? "line-through text-slate-500" : ""}">
							${escapeHtml(t.title || "")}
						</div>
						<div class="text-xs text-slate-500 mt-0.5">
							${escapeHtml(t.course || "GENERAL")} • ${escapeHtml(t.duration || "")} • ${escapeHtml(t.date || "No date")}
						</div>
					</div>
					<span class="px-2.5 py-1 rounded-full text-xs font-bold shrink-0 ${
						t.done
							? "bg-emerald-50 text-emerald-700 border border-emerald-200"
							: "bg-amber-50 text-amber-800 border border-amber-200"
					}">
						${t.done ? "Completed" : "Incomplete"}
					</span>
				`;
				taskListCont.appendChild(row);
			});
		}
	}

	const dlListCont = document.getElementById("historyDeadlinesList");
	if (dlListCont) {
		dlListCont.innerHTML = "";
		if (allHistoryDeadlines.length === 0) {
			dlListCont.innerHTML = `
				<div class="p-6 text-center text-slate-400 border border-dashed border-slate-200 rounded-2xl text-sm">
					No past or expired deadlines recorded yet.
				</div>
			`;
		} else {
			allHistoryDeadlines.forEach((d) => {
				const row = document.createElement("div");
				row.className =
					"p-3.5 rounded-2xl border border-slate-200 bg-slate-50/50 flex items-center justify-between gap-2 text-sm";
				row.innerHTML = `
					<div class="overflow-hidden">
						<div class="font-bold text-slate-800 truncate">${escapeHtml(d.title || "")}</div>
						<div class="text-xs text-slate-500 mt-0.5">
							${escapeHtml(d.course || "GENERAL")} • ${escapeHtml(d.type || "Deadline")} • Due ${escapeHtml(d.date || "")}
						</div>
					</div>
					<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200 shrink-0">
						${escapeHtml(d.source || "Past")}
					</span>
				`;
				dlListCont.appendChild(row);
			});
		}
	}

	if (typeof lucide !== "undefined") {
		lucide.createIcons();
	}
}

function exportHistoryReport() {
	const payload = {
		exportedAt: new Date().toISOString(),
		profile: appData.userProfile,
		currentCourses: appData.courses,
		history: {
			...appData.history,
			semesters: getAllSemesterSnapshots(),
		},
	};

	const blob = new Blob([JSON.stringify(payload, null, 2)], {
		type: "application/json",
	});
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = `SynapseLoad_Academic_History_${getTodayISO()}.json`;
	a.click();
	URL.revokeObjectURL(url);

	showToast("Academic history exported.");
}

/* ================================================================
   DASHBOARD & COLLISION DETECTOR
   ================================================================ */

function parseHours(value) {
	const n = parseFloat(String(value ?? "").replace(/[^0-9.]/g, ""));
	return Number.isFinite(n) ? n : 0;
}

function calculateAcademicRisks() {
	const risks = [];

	const today = new Date();
	today.setHours(0, 0, 0, 0);

	const capacityPerDay = Number(appData.userProfile.dailyStudyHours);

	const defaultCapacity =
		Number.isFinite(capacityPerDay) && capacityPerDay > 0 ? capacityPerDay : 0;

	if (defaultCapacity <= 0) {
		return risks;
	}

	for (const d of appData.deadlines) {
		if (!isValidISODate(d.date)) {
			continue;
		}

		const due = new Date(d.date + "T23:59:59");
		const days = Math.max(0, Math.ceil((due - today) / 86400000));
		const effort = parseHours(d.intensity);

		if (effort <= 0) {
			continue;
		}

		const available = defaultCapacity * days;
		const ratio = available > 0 ? effort / available : 1;

		const level =
			ratio >= 1
				? "Critical"
				: ratio >= 0.75
					? "High"
					: ratio >= 0.5
						? "Moderate"
						: "Low";

		risks.push({
			deadline: d,
			days,
			effort,
			available,
			ratio,
			level,
		});
	}

	return risks.sort((a, b) => b.ratio - a.ratio);
}

function renderCollisionView() {
	const container = document.getElementById("collisionDetectorContainer");
	if (!container) return;

	const capacity = getEffectiveDailyStudyHours();
	if (capacity <= 0) {
		container.innerHTML = `
			<div class="bg-white rounded-3xl border border-amber-200 p-8 text-center space-y-3 shadow-xs">
				<div class="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-100 text-amber-600 flex items-center justify-center mx-auto">
					<i data-lucide="sliders" class="w-6 h-6"></i>
				</div>
				<h3 class="text-lg font-bold text-slate-900">Daily Study Capacity Not Set</h3>
				<p class="text-sm text-slate-500 max-w-md mx-auto">
					Set your available study hours per day in <strong>Profile &amp; Semester</strong> so the engine can calculate deadline collisions.
				</p>
				<button type="button" onclick="switchView('profile')" class="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold transition">
					Set Study Hours &rarr;
				</button>
			</div>
		`;
		if (typeof lucide !== "undefined") lucide.createIcons();
		return;
	}

	const risks = calculateAcademicRisks();
	if (risks.length === 0) {
		container.innerHTML = `
			<div class="bg-white rounded-3xl border border-slate-200/80 p-8 text-center text-slate-500 space-y-3 shadow-xs">
				<div class="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
					<i data-lucide="shield-check" class="w-6 h-6"></i>
				</div>
				<h3 class="text-lg font-bold text-slate-800">No Collisions Found</h3>
				<p class="text-sm max-w-md mx-auto">
					Your academic schedule currently has balanced workload distribution (${capacity}h/day available capacity).
				</p>
			</div>
		`;
		if (typeof lucide !== "undefined") lucide.createIcons();
		return;
	}

	container.innerHTML = "";

	risks.forEach((r) => {
		const pct = Math.round(r.ratio * 100);
		const isCritical = r.level === "Critical";
		const isHigh = r.level === "High";
		const isModerate = r.level === "Moderate";

		const cardBorder = isCritical
			? "border-red-200 bg-white"
			: isHigh
				? "border-orange-200 bg-white"
				: isModerate
					? "border-amber-200 bg-white"
					: "border-slate-200/80 bg-white";

		const badgeStyle = isCritical
			? "bg-red-50 text-red-700 border border-red-200"
			: isHigh
				? "bg-orange-50 text-orange-700 border border-orange-200"
				: isModerate
					? "bg-amber-50 text-amber-800 border border-amber-200"
					: "bg-emerald-50 text-emerald-700 border border-emerald-200";

		const card = document.createElement("div");
		card.className = `p-5 rounded-3xl border ${cardBorder} shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4`;
		card.innerHTML = `
			<div class="space-y-1.5">
				<div class="flex flex-wrap items-center gap-2">
					<span class="px-3 py-0.5 rounded-full text-xs font-black uppercase ${badgeStyle}">
						${escapeHtml(r.level)} Risk (${pct}% Load)
					</span>
					<span class="text-xs font-mono font-bold text-indigo-700">
						${escapeHtml(r.deadline.course || "GENERAL")}
					</span>
					<span class="text-xs text-slate-500">
						• Due ${escapeHtml(r.deadline.date)} (${r.days} day${r.days === 1 ? "" : "s"} left)
					</span>
				</div>
				<h4 class="font-bold text-slate-900 text-base">
					${escapeHtml(r.deadline.title || "")}
				</h4>
				<p class="text-sm text-slate-600">
					Required Prep: <strong>${r.effort} hrs</strong> &bull; Available Window Capacity: <strong>${r.available.toFixed(1)} hrs</strong> (${capacity}h/day)
				</p>
			</div>
			<div class="shrink-0">
				<button type="button" onclick="triggerAiScheduleRebalance(); switchView('planner');" class="px-4 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl text-sm font-bold transition">
					Distribute Prep Blocks &rarr;
				</button>
			</div>
		`;
		container.appendChild(card);
	});

	if (typeof lucide !== "undefined") {
		lucide.createIcons();
	}
}

function refreshDashboard() {
	const risks = calculateAcademicRisks();

	const collisions = risks.filter(
		(r) => r.level === "Critical" || r.level === "High",
	);

	const hasCollisions = collisions.length > 0;

	const banner = document.getElementById("collisionBanner");
	const navDot = document.getElementById("navCollisionDot");
	const sideBadge = document.getElementById("sidebarCollisionBadge");
	const sideSummary = document.getElementById("sidebarCollisionSummary");

	if (banner && navDot && sideBadge && sideSummary) {
		if (hasCollisions) {
			banner.classList.remove("hidden");
			navDot.className = "ml-auto w-2 h-2 rounded-full bg-red-500 animate-ping";
			sideBadge.className =
				"inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700 border border-red-200 font-bold";
			sideBadge.innerText = `${collisions.length} Risk!`;
			sideSummary.innerText = `Deadline: ${collisions[0].deadline.title}`;
		} else {
			banner.classList.add("hidden");
			navDot.className = "ml-auto w-2 h-2 rounded-full bg-slate-300";
			sideBadge.className =
				"inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-slate-200/80 text-slate-700 font-bold";
			sideBadge.innerText = "0 Active";
			sideSummary.innerText = "No high-risk workload detected";
		}
	}

	const metricCollisionCount = document.getElementById("metricCollisionCount");
	if (metricCollisionCount) {
		metricCollisionCount.innerText = `${collisions.length} Detected`;
	}

	const metricCollisionSubtext = document.getElementById(
		"metricCollisionSubtext",
	);
	if (metricCollisionSubtext) {
		metricCollisionSubtext.innerText = hasCollisions
			? `Due: ${collisions[0].deadline.date}`
			: "Schedule clear";
	}

	const listContainer = document.getElementById("todaysClassesList");

	if (listContainer) {
		listContainer.innerHTML = "";

		const dayNames = [
			"Sunday",
			"Monday",
			"Tuesday",
			"Wednesday",
			"Thursday",
			"Friday",
			"Saturday",
		];

		const todayName = dayNames[new Date().getDay()];
		const classes = appData.timetable[todayName] || [];

		if (classes.length === 0) {
			listContainer.innerHTML = `
				<div class="p-6 text-center text-slate-400 border border-dashed border-slate-200 rounded-2xl">
					<p class="text-sm">
						No classes added for today.
					</p>
				</div>
			`;
		} else {
			classes.forEach((c) => {
				const isLab = String(c.type || "")
					.toLowerCase()
					.includes("lab");
				const colorBg = isLab
					? "border-violet-200 bg-violet-50/40"
					: "border-slate-200/80 bg-slate-50/60";
				const badgeColor = isLab
					? "bg-violet-100 text-violet-700"
					: "bg-slate-200/80 text-slate-700";

				const el = document.createElement("div");
				el.className = `p-3.5 rounded-2xl border ${colorBg} flex items-center justify-between text-sm transition hover:shadow-xs`;
				el.innerHTML = `
					<div class="flex items-center gap-3">
						<span class="font-mono text-slate-500 font-semibold text-xs">
							${escapeHtml(c.time || "")}
						</span>
						<div>
							<div class="font-bold text-slate-900">
								${escapeHtml(c.course || "")}
							</div>
							<div class="text-xs text-slate-500">
								${escapeHtml(c.room || "Room not specified")} • ${escapeHtml(c.type || "Class")}
							</div>
						</div>
					</div>
					<span class="px-2.5 py-0.5 rounded-md text-xs font-bold ${badgeColor}">
						${escapeHtml(c.type || "Class")}
					</span>
				`;

				listContainer.appendChild(el);
			});
		}
	}

	const metricClassLoad = document.getElementById("metricClassLoad");
	if (metricClassLoad) {
		const dayNames = [
			"Sunday",
			"Monday",
			"Tuesday",
			"Wednesday",
			"Thursday",
			"Friday",
			"Saturday",
		];
		const todayName = dayNames[new Date().getDay()];
		metricClassLoad.innerText = `${(appData.timetable[todayName] || []).length} Sessions`;
	}

	renderWeeklyPaceGrid();
	renderDashboardCourseNames();
	renderTodoList();
	renderDeadlinesList();
	renderCollisionView();
	renderCoursesTable();
	updateFocusCourseSelect();

	if (typeof lucide !== "undefined") {
		lucide.createIcons();
	}
}

function renderWeeklyPaceGrid() {
	const grid = document.getElementById("weeklyPaceGrid");
	if (!grid) {
		return;
	}

	grid.innerHTML = "";
	const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

	days.forEach((day) => {
		const isSat = day === "Sat";
		const isSatOff =
			isSat &&
			(appData.userProfile.saturdayRule === "all_off" ||
				appData.userProfile.saturdayRule === "alternate");

		const card = document.createElement("div");
		card.className =
			"p-3.5 rounded-2xl border border-slate-200/80 bg-slate-50/50 flex flex-col justify-between text-center space-y-2";

		card.innerHTML = `
			<span class="text-sm font-bold text-slate-700 uppercase tracking-wider">
				${day}
			</span>
			<div class="flex items-center justify-center gap-1.5">
				<span class="w-2 h-2 rounded-full ${
					isSatOff ? "bg-blue-500" : "bg-emerald-500"
				}"></span>
				<span class="text-xs font-bold text-slate-800">
					${isSatOff ? "Holiday" : "Open"}
				</span>
			</div>
			<span class="text-xs text-slate-500 font-medium truncate block">
				${isSatOff ? "Weekend Buffer" : "Available"}
			</span>
		`;

		grid.appendChild(card);
	});
}

function renderDashboardCourseNames() {
	const container = document.getElementById("dashboardCourseNamesList");
	if (!container) return;

	container.innerHTML = "";

	if (!appData.courses || appData.courses.length === 0) {
		container.innerHTML = `
			<span class="text-sm text-slate-400">
				No courses added yet.
			</span>
		`;
		return;
	}

	appData.courses.forEach((c) => {
		const name = String(c.name || c.code || "").trim();
		if (!name) return;

		const badge = document.createElement("span");
		badge.className =
			"px-3.5 py-2 rounded-xl bg-indigo-50/70 border border-indigo-100 text-indigo-800 font-semibold text-sm";
		badge.innerText = name;
		container.appendChild(badge);
	});
}

/* ================================================================
   ROBUST CALENDAR & DATE NORMALIZER
   ================================================================ */

function isValidISODate(value) {
	if (typeof value !== "string") return false;
	const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!match) return false;

	const y = parseInt(match[1], 10);
	const m = parseInt(match[2], 10);
	const d = parseInt(match[3], 10);

	if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) {
		return false;
	}

	const testDate = new Date(y, m - 1, d);
	return (
		testDate.getFullYear() === y &&
		testDate.getMonth() === m - 1 &&
		testDate.getDate() === d
	);
}

function setQuickDate(inputId, daysAhead) {
	const el = document.getElementById(inputId);
	if (!el) return;
	const target = new Date();
	target.setDate(target.getDate() + daysAhead);
	el.value = formatLocalISO(target);
}

function populateCourseDropdown(selectId, selectedValue = "") {
	const sel = document.getElementById(selectId);
	if (!sel) return;
	sel.innerHTML = '<option value="GENERAL">General Study</option>';

	(appData.courses || []).forEach((c) => {
		const opt = document.createElement("option");
		opt.value = c.code;
		opt.innerText = `${c.code} (${c.name || "Subject"})`;
		if (c.code === selectedValue) opt.selected = true;
		sel.appendChild(opt);
	});
}

/* ================================================================
   MODAL-DRIVEN TASK WORKFLOW + TOTAL TIME COUNTER
   ================================================================ */

function renderTodoList() {
	const todoCont = document.getElementById("smartTodoList");
	if (!todoCont) {
		return;
	}

	todoCont.innerHTML = "";

	if (appData.tasks.length === 0) {
		todoCont.innerHTML = `
			<div class="p-6 text-center text-slate-400 border border-dashed border-slate-200 rounded-2xl">
				<p class="text-sm">
					No study tasks. Add a task to schedule focused preparation.
				</p>
			</div>
		`;
		return;
	}

	let totalHours = 0;
	let remainingHours = 0;
	appData.tasks.forEach((t) => {
		const hrs = parseHours(t.duration);
		totalHours += hrs;
		if (!t.done) remainingHours += hrs;
	});

	const summaryBar = document.createElement("div");
	summaryBar.className =
		"px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between text-xs font-semibold text-slate-600 mb-1";
	summaryBar.innerHTML = `
		<span>Total Planned: <strong class="text-slate-900">${totalHours.toFixed(1)} hrs</strong></span>
		<span>Remaining: <strong class="text-indigo-600">${remainingHours.toFixed(1)} hrs</strong></span>
	`;
	todoCont.appendChild(summaryBar);

	appData.tasks.forEach((t) => {
		const div = document.createElement("div");
		div.className = `p-3.5 rounded-2xl border ${
			t.done ? "bg-slate-50/60 border-slate-100" : "bg-white border-slate-200/90"
		} flex items-center justify-between text-sm transition-all`;

		div.innerHTML = `
			<div class="flex items-center gap-3 overflow-hidden">
				<input
					type="checkbox"
					onchange="toggleTaskDone(${t.id})"
					${t.done ? "checked" : ""}
					class="w-4 h-4 rounded text-indigo-600 cursor-pointer shrink-0"
				>
				<div class="overflow-hidden">
					<div class="font-bold truncate transition-all ${
						t.done ? "line-through text-slate-400" : "text-slate-800"
					}">
						${escapeHtml(t.title || "")}
					</div>
					<div class="text-xs text-slate-500 mt-0.5 ${t.done ? "line-through" : ""}">
						${escapeHtml(t.course || "")} • Est: ${escapeHtml(t.duration || "")} • ${escapeHtml(t.date || "")}
					</div>
				</div>
			</div>
			<div class="flex items-center gap-1 shrink-0">
				<button
					onclick="startFocusWithCourse('${escapeHtml(t.course || "GENERAL")}')"
					class="p-2 rounded-lg hover:bg-indigo-50 text-indigo-600"
					title="Focus"
				>
					<i data-lucide="play" class="w-4 h-4"></i>
				</button>
				<button
					onclick="editTaskPrompt(${t.id})"
					class="p-2 rounded-lg hover:bg-slate-100"
					title="Edit"
				>
					<i data-lucide="edit-2" class="w-4 h-4"></i>
				</button>
				<button
					onclick="deleteTask(${t.id})"
					class="p-2 rounded-lg hover:bg-red-50 text-red-500"
					title="Delete"
				>
					<i data-lucide="trash-2" class="w-4 h-4"></i>
				</button>
			</div>
		`;

		todoCont.appendChild(div);
	});

	if (typeof lucide !== "undefined") {
		lucide.createIcons();
	}
}

function addNewTaskPrompt() {
	const modal = document.getElementById("taskModal");
	if (!modal) return;

	const modalTitle = document.getElementById("taskModalTitle");
	const editId = document.getElementById("taskEditId");
	const titleInput = document.getElementById("taskTitleInput");
	const durationInput = document.getElementById("taskDurationInput");

	if (modalTitle) modalTitle.innerText = "Add Study Task";
	if (editId) editId.value = "";
	if (titleInput) titleInput.value = "";
	if (durationInput) durationInput.value = "1.5";

	setQuickDate("taskDateInput", 0);
	populateCourseDropdown("taskCourseSelect");

	modal.classList.remove("hidden");
	setTimeout(() => titleInput?.focus(), 80);
}

function editTaskPrompt(taskId) {
	const task = appData.tasks.find((x) => x.id === taskId);
	if (!task) return;

	const modal = document.getElementById("taskModal");
	if (!modal) return;

	const modalTitle = document.getElementById("taskModalTitle");
	const editId = document.getElementById("taskEditId");
	const titleInput = document.getElementById("taskTitleInput");
	const durationInput = document.getElementById("taskDurationInput");
	const dateInput = document.getElementById("taskDateInput");

	if (modalTitle) modalTitle.innerText = "Edit Study Task";
	if (editId) editId.value = task.id;
	if (titleInput) titleInput.value = task.title || "";
	if (durationInput) durationInput.value = parseHours(task.duration) || 1.5;

	const dateVal = isValidISODate(task.date) ? task.date : getTodayISO();
	if (dateInput) dateInput.value = dateVal;

	populateCourseDropdown("taskCourseSelect", task.course);
	modal.classList.remove("hidden");
}

function closeTaskModal() {
	const modal = document.getElementById("taskModal");
	if (modal) modal.classList.add("hidden");
}

function handleTaskModalSubmit(e) {
	e.preventDefault();
	const editId = document.getElementById("taskEditId")?.value;
	const title = document.getElementById("taskTitleInput")?.value.trim();
	const course = document.getElementById("taskCourseSelect")?.value || "GENERAL";
	const hours =
		parseFloat(document.getElementById("taskDurationInput")?.value) || 1.0;
	const rawDate = document.getElementById("taskDateInput")?.value;

	if (!title) {
		showToast("Please enter a task description.", true);
		return;
	}

	if (editId) {
		const task = appData.tasks.find((x) => String(x.id) === String(editId));
		if (task) {
			task.title = title;
			task.course = course;
			task.duration = `${hours} hrs`;
			task.date = rawDate;
		}
		showToast("Task updated!");
	} else {
		appData.tasks.unshift({
			id: Date.now(),
			title: title,
			course: course,
			duration: `${hours} hrs`,
			done: false,
			date: rawDate,
			tag: "Study Block",
		});
		showToast("Study block scheduled!");
	}

	closeTaskModal();
	renderTodoList();
	renderPlannerView();
	syncAllToFirestore();
}

async function deleteTask(taskId) {
	if (!confirm("Are you sure you want to delete this task?")) {
		return;
	}

	appData.tasks = appData.tasks.filter((t) => t.id !== taskId);
	await deleteCloudDocument("tasks", taskId);

	renderTodoList();
	renderPlannerView();
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

/* ================================================================
   MODAL-DRIVEN DEADLINE WORKFLOW
   ================================================================ */

function renderDeadlinesList() {
	const deadlineCont = document.getElementById("deadlinesList");
	if (!deadlineCont) {
		return;
	}

	deadlineCont.innerHTML = "";

	if (appData.deadlines.length === 0) {
		deadlineCont.innerHTML = `
			<div class="p-6 text-center text-slate-400 border border-dashed border-slate-200 rounded-2xl">
				<p class="text-sm">
					No deadlines registered.
				</p>
			</div>
		`;
		return;
	}

	appData.deadlines.forEach((d) => {
		if (!isValidISODate(d.date)) {
			return;
		}

		const isRisk = d.collision || parseHours(d.intensity) >= 8;
		const parts = d.date.split("-");

		const displayDate = new Date(
			parseInt(parts[0], 10),
			parseInt(parts[1], 10) - 1,
			parseInt(parts[2], 10),
		);

		const div = document.createElement("div");
		div.className = `p-3.5 rounded-2xl border flex items-center justify-between text-sm ${
			isRisk ? "border-red-200 bg-red-50/40" : "border-slate-200/90 bg-white"
		}`;

		div.innerHTML = `
			<div class="flex items-center gap-3 overflow-hidden">
				<div class="p-2.5 rounded-xl ${
					isRisk ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"
				} font-bold text-center min-w-[54px] shrink-0">
					<span class="block text-xs uppercase">
						${displayDate.toLocaleString("default", { month: "short" })}
					</span>
					<span class="text-base font-black">
						${displayDate.getDate()}
					</span>
				</div>
				<div class="overflow-hidden">
					<div class="font-bold text-slate-800 truncate">
						${escapeHtml(d.title || "")}
					</div>
					<div class="text-slate-500 text-xs truncate mt-0.5">
						${escapeHtml(d.course || "")} • ${escapeHtml(d.type || "")} • ${d.intensity || 0}h Load
					</div>
				</div>
			</div>
			<div class="flex items-center gap-2 shrink-0 ml-2">
				${
					isRisk
						? `<span class="px-2.5 py-0.5 rounded-md text-xs font-black bg-red-600 text-white uppercase">
								Risk
						   </span>`
						: ""
				}
				<button
					onclick="editDeadlinePrompt(${d.id})"
					class="p-2 rounded-lg hover:bg-slate-100"
					title="Edit"
				>
					<i data-lucide="edit-2" class="w-4 h-4"></i>
				</button>
				<button
					onclick="deleteDeadline(${d.id})"
					class="p-2 rounded-lg hover:bg-red-50 text-red-500"
					title="Delete"
				>
					<i data-lucide="trash-2" class="w-4 h-4"></i>
				</button>
			</div>
		`;

		deadlineCont.appendChild(div);
	});

	if (typeof lucide !== "undefined") {
		lucide.createIcons();
	}
}

function addNewDeadlinePrompt() {
	const modal = document.getElementById("deadlineModal");
	if (!modal) return;

	const modalTitle = document.getElementById("deadlineModalTitle");
	const editId = document.getElementById("deadlineEditId");
	const titleInput = document.getElementById("deadlineTitleInput");
	const typeSelect = document.getElementById("deadlineTypeSelect");
	const intensityInput = document.getElementById("deadlineIntensityInput");

	if (modalTitle) modalTitle.innerText = "Add Academic Deadline";
	if (editId) editId.value = "";
	if (titleInput) titleInput.value = "";
	if (typeSelect) typeSelect.value = "Assignment";
	if (intensityInput) intensityInput.value = "4.0";

	setQuickDate("deadlineDateInput", 7);
	populateCourseDropdown("deadlineCourseSelect");

	modal.classList.remove("hidden");
	setTimeout(() => titleInput?.focus(), 80);
}

function editDeadlinePrompt(deadlineId) {
	const deadline = appData.deadlines.find((d) => d.id === deadlineId);
	if (!deadline) return;

	const modal = document.getElementById("deadlineModal");
	if (!modal) return;

	const modalTitle = document.getElementById("deadlineModalTitle");
	const editId = document.getElementById("deadlineEditId");
	const titleInput = document.getElementById("deadlineTitleInput");
	const typeSelect = document.getElementById("deadlineTypeSelect");
	const intensityInput = document.getElementById("deadlineIntensityInput");
	const dateInput = document.getElementById("deadlineDateInput");

	if (modalTitle) modalTitle.innerText = "Edit Deadline";
	if (editId) editId.value = deadline.id;
	if (titleInput) titleInput.value = deadline.title || "";
	if (typeSelect) typeSelect.value = deadline.type || "Assignment";
	if (intensityInput)
		intensityInput.value = parseHours(deadline.intensity) || 4.0;
	if (dateInput) dateInput.value = deadline.date || "";

	populateCourseDropdown("deadlineCourseSelect", deadline.course);
	modal.classList.remove("hidden");
}

function closeDeadlineModal() {
	const modal = document.getElementById("deadlineModal");
	if (modal) modal.classList.add("hidden");
}

function handleDeadlineModalSubmit(e) {
	e.preventDefault();
	const editId = document.getElementById("deadlineEditId")?.value;
	const title = document.getElementById("deadlineTitleInput")?.value.trim();
	const course =
		document.getElementById("deadlineCourseSelect")?.value || "GENERAL";
	const type =
		document.getElementById("deadlineTypeSelect")?.value || "Assignment";
	const hours =
		parseFloat(document.getElementById("deadlineIntensityInput")?.value) || 3.0;
	const rawDate = document.getElementById("deadlineDateInput")?.value.trim();

	if (!title) {
		showToast("Please enter a milestone title.", true);
		return;
	}

	if (!isValidISODate(rawDate)) {
		showToast("Please select a valid date in YYYY-MM-DD format.", true);
		return;
	}

	if (editId) {
		const deadline = appData.deadlines.find(
			(d) => String(d.id) === String(editId),
		);
		if (deadline) {
			deadline.title = title;
			deadline.course = course;
			deadline.type = type;
			deadline.intensity = hours;
			deadline.date = rawDate;
		}
		showToast("Deadline updated successfully!");
	} else {
		appData.deadlines.push({
			id: Date.now(),
			title: title,
			course: course,
			date: rawDate,
			type: type,
			intensity: hours,
			collision: false,
		});
		showToast(`Added: ${title}`);
	}

	closeDeadlineModal();
	refreshDashboard();
	renderCalendar();
	syncAllToFirestore();
}

async function deleteDeadline(deadlineId) {
	if (!confirm("Are you sure you want to remove this deadline?")) {
		return;
	}

	appData.deadlines = appData.deadlines.filter((d) => d.id !== deadlineId);
	await deleteCloudDocument("deadlines", deadlineId);

	refreshDashboard();
	renderCalendar();
	syncAllToFirestore();

	showToast("Deadline deleted.");
}

const FACULTY_LINE_REGEX =
	/(\b(?:prof|dr|mr|mrs|ms|miss|shri|smt|er)\.?\s+[a-z]{2,}|\bfaculty\b|\binstructor\b|\bteacher\b|\bprofessor\b|\blecturer\b|\bcoordinator\b|\bhod\b|\bdept\.?\s*of\b)/i;

function isLikelyPersonOrFacultyName(text) {
	const cleaned = String(text || "").trim();
	if (!cleaned) return true;
	if (FACULTY_LINE_REGEX.test(cleaned)) return true;
	const words = cleaned.split(/\s+/);
	const hasAcademicKeyword =
		/(exam|test|mid|end|sem|quiz|viva|lab|lec|tutorial|assignment|project|submission|holiday|break|vacation|recess|lecture|practical|workshop|seminar|review|marksheet|answer\s*sheet|total|marks|score|grade)/i.test(
			cleaned,
		);
	if (
		!hasAcademicKeyword &&
		!/\d/.test(cleaned) &&
		words.length >= 2 &&
		words.length <= 3 &&
		words.every((w) => /^[A-Z][a-z]{1,18}\.?$/.test(w))
	) {
		return true;
	}
	return false;
}

function marksToGradePoint10(marks, maxMarks = 100) {
	const m = Number(marks);
	const max = Number(maxMarks) > 0 ? Number(maxMarks) : 100;
	if (!Number.isFinite(m) || m < 0) return null;
	const pct = (m / max) * 100;
	if (pct >= 90) return 10;
	if (pct >= 80) return 9;
	if (pct >= 70) return 8;
	if (pct >= 60) return 7;
	if (pct >= 50) return 6;
	if (pct >= 45) return 5;
	if (pct >= 40) return 4;
	return 0;
}

function parseMarksExpression(raw) {
	const str = String(raw ?? "").trim();
	if (!str) return { marks: null, maxMarks: 100, display: "" };
	const slashMatch = str.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
	if (slashMatch) {
		const m = Number(slashMatch[1]);
		const max = Number(slashMatch[2]);
		return { marks: m, maxMarks: max || 100, display: `${m}/${max || 100}` };
	}
	const num = parseFloat(str.replace(/[^0-9.]/g, ""));
	if (Number.isFinite(num)) {
		return { marks: num, maxMarks: 100, display: String(num) };
	}
	return { marks: null, maxMarks: 100, display: str };
}

function saveGeminiApiKey(key) {
	if (key) {
		localStorage.setItem("synapse_gemini_key", key.trim());
		showToast("Vision API key saved locally.");
	}
}

async function handleFileUpload(event) {
	const input = event.target;
	const file = input.files?.[0];
	if (!file) {
		return;
	}

	const badge = document.getElementById("ocrStatusBadge");
	if (badge) {
		badge.classList.remove("hidden");
	}

	showToast(`Processing "${file.name}"...`);

	try {
		const apiKey = (localStorage.getItem("synapse_gemini_key") || "").trim();

		if (apiKey) {
			try {
				await extractWithGeminiVision(file, apiKey);
				return;
			} catch (visionErr) {
				console.warn(
					"Vision API failed, falling back to local parser:",
					visionErr,
				);
				showToast(
					"Vision API unavailable — using built-in document parser...",
				);
			}
		}

		await extractWithClientEngines(file);
	} catch (err) {
		console.error("Extraction error:", err);
		showToast(`Extraction failed: ${err.message}`, true);
	} finally {
		if (badge) {
			badge.classList.add("hidden");
		}
		input.value = "";
	}
}

async function extractWithGeminiVision(file, apiKey) {
	const base64Data = await fileToBase64(file);
	const mimeType = file.type || "application/octet-stream";

	const promptText = `
You are a strict academic-document extraction engine for university timetables, syllabi, marksheets, grade cards, checked answer sheets, and exam schedules.

Read ONLY information visibly present in the supplied document.

CRITICAL EXCLUSIONS:
- NEVER extract teacher names, professor names, examiner names, or staff names (e.g. "Prof. Sharma", "Dr. Rao", "Ms. Patel") as events, courses, or titles.
- NEVER guess, invent, or use today's date.
- If a value is unclear or missing, return null.

MARKSHEET & CHECKED ANSWER SHEET RULES:
- If the image/PDF is a marksheet or grade card, extract each subject's course code (or generate a clean short code like SUBJ101 if only subject name is shown), subject name, credits, marks obtained (e.g. "82/100" or "82"), and gradePoint (on a 10-point scale if shown).
- If the image/PDF is a checked answer sheet / test paper, extract the subject/course name or code and the total marks obtained (e.g. "24/30" or "68/100") into that subject's "marks" field.

Return ONLY valid JSON using this exact schema:

{
  "courses": [
    {
      "code": "string",
      "name": "string",
      "credits": number or null,
      "lecsPerWeek": number or null,
      "labsPerWeek": number or null,
      "marks": "string or null",
      "gradePoint": number or null,
      "confidence": number,
      "evidence": "string"
    }
  ],

  "timetable": [
    {
      "day": "Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday",
      "start": "HH:MM",
      "end": "HH:MM",
      "course": "string",
      "type": "Lecture|Lab|Tutorial|Other",
      "room": "string or null",
      "confidence": number,
      "evidence": "string"
    }
  ],

  "events": [
    {
      "title": "string",
      "date": "YYYY-MM-DD or null",
      "type": "Exam|Submission|Holiday|Other",
      "course": "string or null",
      "effortHours": number or null,
      "confidence": number,
      "evidence": "string"
    }
  ]
}
`;

	const requestBody = {
		contents: [
			{
				parts: [
					{ text: promptText },
					{
						inline_data: {
							mime_type: mimeType,
							data: base64Data.split(",")[1],
						},
					},
				],
			},
		],
		generationConfig: {
			response_mime_type: "application/json",
			temperature: 0,
		},
	};

	const models = ["gemini-2.5-flash", "gemini-2.0-flash"];
	let lastError = null;

	for (const model of models) {
		const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
			apiKey,
		)}`;

		const res = await fetch(endpoint, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(requestBody),
		});

		if (!res.ok) {
			lastError = new Error(`Vision API (${model}) status ${res.status}`);
			continue;
		}

		const data = await res.json();
		const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;

		if (!raw) {
			lastError = new Error("Vision engine returned empty output.");
			continue;
		}

		let parsed;
		try {
			const cleanJson = raw
				.replace(/^```json\s*/i, "")
				.replace(/```\s*$/, "")
				.trim();
			parsed = JSON.parse(cleanJson);
		} catch {
			lastError = new Error("Vision engine returned invalid JSON.");
			continue;
		}

		setVerifiedDraft(parsed, file.name, "Gemini Vision");
		return;
	}

	throw lastError || new Error("Vision API failed.");
}

function normaliseTime(value) {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	const m24 = trimmed.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
	if (m24) {
		return `${m24[1].padStart(2, "0")}:${m24[2]}`;
	}
	const m12 = trimmed.match(/^(1[0-2]|0?[1-9]):([0-5]\d)\s*(AM|PM)$/i);
	if (m12) {
		let h = parseInt(m12[1], 10);
		const isPm = m12[3].toUpperCase() === "PM";
		if (isPm && h !== 12) h += 12;
		if (!isPm && h === 12) h = 0;
		return `${String(h).padStart(2, "0")}:${m12[2]}`;
	}
	return null;
}

function validateExtractedData(parsed) {
	const coursesInput = Array.isArray(parsed?.courses) ? parsed.courses : [];
	const timetableInput = Array.isArray(parsed?.timetable)
		? parsed.timetable
		: [];
	const eventsInput = Array.isArray(parsed?.events) ? parsed.events : [];

	const courseCodes = new Set();
	const validDays = new Set([
		"Monday",
		"Tuesday",
		"Wednesday",
		"Thursday",
		"Friday",
		"Saturday",
		"Sunday",
	]);

	const codePattern = /^[A-Z]{2,8}[-\s]?[0-9]{1,4}[A-Z0-9-]*$/i;
	const courses = [];

	for (const c of coursesInput) {
		const code = String(c?.code || "")
			.trim()
			.toUpperCase()
			.replace(/\s+/g, "");
		const name = String(c?.name || "").trim();
		const confidence = Number(c?.confidence ?? 0.8);

		if (
			!code ||
			!codePattern.test(code) ||
			confidence < 0.5 ||
			courseCodes.has(code) ||
			isLikelyPersonOrFacultyName(name)
		) {
			continue;
		}

		courseCodes.add(code);

		const marksStr =
			c?.marks !== null && c?.marks !== undefined
				? String(c.marks).trim()
				: "";
		const parsedMarks = parseMarksExpression(marksStr);
		const explicitGp = Number(c?.gradePoint);
		const derivedGp =
			Number.isFinite(explicitGp) && explicitGp >= 0 && explicitGp <= 10
				? explicitGp
				: parsedMarks.marks !== null
					? marksToGradePoint10(parsedMarks.marks, parsedMarks.maxMarks)
					: null;

		courses.push({
			code,
			name: name || code,
			credits: Number.isFinite(Number(c?.credits)) ? Number(c.credits) : null,
			lecsPerWeek: Number.isFinite(Number(c?.lecsPerWeek))
				? Number(c.lecsPerWeek)
				: null,
			labsPerWeek: Number.isFinite(Number(c?.labsPerWeek))
				? Number(c.labsPerWeek)
				: null,
			grade: marksStr || null,
			gradePoint: derivedGp,
			confidence,
			evidence: String(c?.evidence || ""),
		});
	}

	const timetable = timetableInput
		.map((t) => ({
			...t,
			startNorm: normaliseTime(t?.start),
			endNorm: normaliseTime(t?.end),
			courseClean: String(t?.course || "").trim(),
		}))
		.filter((t) => {
			return (
				validDays.has(t?.day) &&
				t.startNorm &&
				t.endNorm &&
				t.courseClean &&
				!isLikelyPersonOrFacultyName(t.courseClean) &&
				Number(t?.confidence ?? 0.8) >= 0.5
			);
		})
		.map((t) => ({
			day: t.day,
			start: t.startNorm,
			end: t.endNorm,
			course: t.courseClean.toUpperCase(),
			type: ["Lecture", "Lab", "Tutorial", "Other"].includes(t.type)
				? t.type
				: "Lecture",
			room: t.room ? String(t.room).trim() : "",
			confidence: Number(t.confidence ?? 0.8),
			evidence: String(t.evidence || ""),
		}));

	const events = eventsInput
		.map((ev, i) => ({
			id: Date.now() + i,
			title: String(ev?.title || "").trim(),
			date: isValidISODate(ev?.date) ? ev.date : null,
			type: ["Exam", "Submission", "Holiday", "Other"].includes(ev?.type)
				? ev.type
				: "Other",
			course: ev?.course ? String(ev.course).trim().toUpperCase() : "",
			intensity: Number.isFinite(Number(ev?.effortHours))
				? Number(ev.effortHours)
				: null,
			confidence: Number(ev?.confidence ?? 0.8),
			evidence: String(ev?.evidence || ""),
		}))
		.filter(
			(ev) =>
				ev.title &&
				ev.confidence >= 0.5 &&
				!isLikelyPersonOrFacultyName(ev.title),
		);

	return {
		courses,
		timetable,
		events,
	};
}

function setVerifiedDraft(parsed, sourceName, sourceEngine) {
	const clean = validateExtractedData(parsed);

	appData.reviewDraft = clean.courses;
	appData.reviewTimetableDraft = clean.timetable;
	appData.reviewEventsDraft = clean.events;

	appData.reviewSource = {
		name: sourceName,
		engine: sourceEngine,
		extractedAt: new Date().toISOString(),
	};

	renderParsedEditableReview();

	const totalExtracted =
		clean.courses.length + clean.timetable.length + clean.events.length;

	if (totalExtracted === 0) {
		showToast(
			"No structured rows were auto-detected. Add your Gemini API key above or add rows manually below.",
			true,
		);
	} else {
		showToast(
			`Extracted ${clean.courses.length} subjects/marks, ${clean.timetable.length} timetable rows and ${clean.events.length} events. Verify before saving.`,
		);
	}
}

function fileToBase64(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result);
		reader.onerror = reject;
		reader.readAsDataURL(file);
	});
}

async function extractWithClientEngines(file) {
	const ext = file.name.split(".").pop().toLowerCase();
	let text = "";

	if (["csv", "txt", "json"].includes(ext)) {
		text = await file.text();
		if (ext === "json") {
			try {
				const maybeStructured = JSON.parse(text);
				if (
					maybeStructured &&
					(Array.isArray(maybeStructured.courses) ||
						Array.isArray(maybeStructured.timetable) ||
						Array.isArray(maybeStructured.events))
				) {
					setVerifiedDraft(maybeStructured, file.name, "JSON Import");
					return;
				}
			} catch {
				// Fall through to line parser
			}
		}
	} else if (ext === "pdf" && typeof pdfjsLib !== "undefined") {
		const pdf = await pdfjsLib.getDocument({
			data: await file.arrayBuffer(),
		}).promise;

		for (let i = 1; i <= pdf.numPages; i++) {
			const page = await pdf.getPage(i);
			const content = await page.getTextContent();

			const rowsByY = new Map();
			for (const item of content.items) {
				const str = String(item.str || "").trim();
				if (!str) continue;
				const y = Math.round((item.transform?.[5] || 0) / 4) * 4;
				if (!rowsByY.has(y)) rowsByY.set(y, []);
				rowsByY.get(y).push({ x: item.transform?.[4] || 0, str });
			}

			const sortedYs = Array.from(rowsByY.keys()).sort((a, b) => b - a);
			for (const y of sortedYs) {
				const rowText = rowsByY
					.get(y)
					.sort((a, b) => a.x - b.x)
					.map((cell) => cell.str)
					.join(" | ");
				text += rowText + "\n";
			}
		}
	} else if (["png", "jpg", "jpeg", "webp"].includes(ext)) {
		throw new Error(
			"Image uploads (marksheets, answer sheets, photos) require a free Gemini Vision API key in the Configuration box on the right.",
		);
	} else {
		throw new Error(
			"Unsupported file type. Upload a PDF, CSV, TXT, JSON, or add a Vision API key for images.",
		);
	}

	parseDocumentLinesPure(text, file.name);
}

function parseDocumentLinesPure(text, sourceName = "uploaded document") {
	const lines = String(text || "")
		.split(/\r?\n/)
		.map((x) => x.trim())
		.filter(Boolean);

	const courses = [];
	const timetable = [];
	const events = [];
	const seenCodes = new Set();

	const coursePattern = /\b([A-Z]{2,6}[-\s]?[0-9]{3,4}[A-Z0-9-]*)\b/;
	const dateRegex =
		/\b(\d{4}-\d{2}-\d{2}|\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})\b/;
	const dayRegex =
		/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/i;
	const timeRangeRegex =
		/\b(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*(?:-|to|–|—)\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)\b/i;
	const marksPattern =
		/\b(\d{1,3}(?:\.\d+)?)\s*\/\s*(\d{2,3})\b|\b(?:total\s*marks?|marks\s*obtained|score)\s*[:=-]?\s*(\d{1,3}(?:\.\d+)?)\b/i;

	const dayMap = {
		mon: "Monday",
		monday: "Monday",
		tue: "Tuesday",
		tuesday: "Tuesday",
		wed: "Wednesday",
		wednesday: "Wednesday",
		thu: "Thursday",
		thursday: "Thursday",
		fri: "Friday",
		friday: "Friday",
		sat: "Saturday",
		saturday: "Saturday",
		sun: "Sunday",
		sunday: "Sunday",
	};

	const stopCodePrefixes =
		/^(THE|AND|FOR|LAB|ROOM|TOTAL|WEEK|CODE|YEAR|HALL|SEM|TIME|DATE|DAY|PAGE|NO|SR|SL|DEPT|MAX|MIN|ROLL|SEAT|REG)[0-9-]*$/i;

	for (const rawLine of lines) {
		const cleanLine = rawLine
			.replace(/\|/g, " ")
			.replace(/\s+/g, " ")
			.trim();
		if (!cleanLine || cleanLine.length < 3) continue;

		const dayMatch = cleanLine.match(dayRegex);
		const timeMatch = cleanLine.match(timeRangeRegex);
		if (dayMatch && timeMatch) {
			const dayFull = dayMap[dayMatch[1].toLowerCase()];
			const startNorm = normaliseTime(timeMatch[1]);
			const endNorm = normaliseTime(timeMatch[2]);

			if (dayFull && startNorm && endNorm) {
				let subject = cleanLine
					.replace(dayMatch[0], "")
					.replace(timeMatch[0], "")
					.replace(FACULTY_LINE_REGEX, "")
					.replace(/^[-:|,;\s]+|[-:|,;\s]+$/g, "")
					.trim();

				const codeInSlot = subject.match(coursePattern);
				const courseLabel = codeInSlot
					? codeInSlot[1].replace(/\s+/g, "").toUpperCase()
					: subject.slice(0, 40).toUpperCase();

				if (courseLabel && !isLikelyPersonOrFacultyName(courseLabel)) {
					timetable.push({
						day: dayFull,
						start: startNorm,
						end: endNorm,
						course: courseLabel,
						type: /\blab\b|\bpractical\b/i.test(cleanLine)
							? "Lab"
							: /\btut/i.test(cleanLine)
								? "Tutorial"
								: "Lecture",
						room: "",
						confidence: 0.78,
						evidence: rawLine,
					});
				}
			}
		}

		const dateMatch = cleanLine.match(dateRegex);
		const eventWords =
			/\b(exam|mid.?sem|end.?sem|insem|endsem|unit\s*test|test|viva|quiz|submission|assignment|deadline|project|journal|presentation|holiday|vacation|break|recess)\b/i.test(
				cleanLine,
			);

		if (eventWords && dateMatch) {
			let iso = null;
			const rawDate = dateMatch[1];

			if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate) && isValidISODate(rawDate)) {
				iso = rawDate;
			} else {
				const parts = rawDate.split(/[\/.-]/);
				if (parts.length === 3) {
					let year = parts[2];
					if (year.length === 2) year = "20" + year;
					const candidate = `${year}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
					if (isValidISODate(candidate)) {
						iso = candidate;
					}
				}
			}

			const titleClean = cleanLine
				.replace(rawDate, "")
				.replace(FACULTY_LINE_REGEX, "")
				.replace(/^[-:|,;\s]+|[-:|,;\s]+$/g, "")
				.trim();

			if (
				iso &&
				titleClean &&
				!isLikelyPersonOrFacultyName(titleClean)
			) {
				events.push({
					id: Date.now() + events.length,
					title: titleClean.slice(0, 80),
					date: iso,
					type: /holiday|vacation|break|recess/i.test(cleanLine)
						? "Holiday"
						: /exam|test|viva|quiz/i.test(cleanLine)
							? "Exam"
							: "Submission",
					effortHours: null,
					confidence: 0.8,
					evidence: rawLine,
				});
				continue;
			}
		}

		const match = cleanLine.match(coursePattern);
		if (!match) continue;

		const code = match[1].replace(/\s+/g, "").toUpperCase();
		if (stopCodePrefixes.test(code) || seenCodes.has(code)) {
			continue;
		}

		const marksMatch = cleanLine.match(marksPattern);
		let marksStr = null;
		let gradePoint = null;
		if (marksMatch) {
			if (marksMatch[1] && marksMatch[2]) {
				marksStr = `${marksMatch[1]}/${marksMatch[2]}`;
				gradePoint = marksToGradePoint10(marksMatch[1], marksMatch[2]);
			} else if (marksMatch[3]) {
				marksStr = marksMatch[3];
				gradePoint = marksToGradePoint10(marksMatch[3], 100);
			}
		}

		let remainder = cleanLine
			.replace(match[0], "")
			.replace(marksPattern, "")
			.replace(FACULTY_LINE_REGEX, "")
			.replace(/^[-:|,;\s]+|[-:|,;\s]+$/g, "")
			.trim();

		const segments = rawLine
			.split("|")
			.map((s) => s.trim())
			.filter(Boolean);
		if (segments.length >= 2) {
			const nonFacultySegments = segments.filter(
				(seg) =>
					!seg.toUpperCase().includes(code) &&
					!isLikelyPersonOrFacultyName(seg) &&
					!/^\d+(?:\.\d+)?(?:\s*\/\s*\d+)?$/.test(seg),
			);
			if (nonFacultySegments.length > 0) {
				remainder = nonFacultySegments[0];
			}
		}

		if (isLikelyPersonOrFacultyName(remainder)) {
			remainder = "";
		}

		const creditsMatch = cleanLine.match(/\b([1-6])\s*(?:cr|credits?)\b/i);

		seenCodes.add(code);
		courses.push({
			code,
			name: remainder || code,
			credits: creditsMatch ? Number(creditsMatch[1]) : null,
			lecsPerWeek: null,
			labsPerWeek: null,
			marks: marksStr,
			gradePoint,
			confidence: remainder ? 0.8 : 0.7,
			evidence: rawLine,
		});
	}

	setVerifiedDraft(
		{
			courses,
			timetable,
			events,
		},
		sourceName,
		"Built-in Structured Parser",
	);
}

/* ================================================================
   IMPORTER EDITOR (Courses, Marks, Timetable & Events)
   ================================================================ */

function loadActiveCoursesIntoDraft() {
	if (appData.courses.length === 0) {
		showToast("No active courses stored.", true);
		return;
	}

	appData.reviewDraft = JSON.parse(JSON.stringify(appData.courses)).map((c) => ({
		...c,
		marks: c.grade ?? c.marks ?? "",
	}));

	appData.reviewTimetableDraft = Object.entries(appData.timetable).flatMap(
		([day, rows]) =>
			rows.map((r) => {
				const m = String(r.time || "").match(
					/^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/,
				);

				return {
					day,
					start: m?.[1] || "",
					end: m?.[2] || "",
					course: r.course || "",
					type: r.type || "Other",
					room: r.room || "",
				};
			}),
	);

	renderParsedEditableReview();
}

function renderParsedEditableReview() {
	const coursesCont = document.getElementById("parsedCoursesEditableList");
	const eventsCont = document.getElementById("parsedEventsEditableList");
	const timetableCont = document.getElementById("parsedTimetableEditableList");

	if (!coursesCont) {
		return;
	}

	coursesCont.innerHTML = "";
	if (eventsCont) eventsCont.innerHTML = "";
	if (timetableCont) timetableCont.innerHTML = "";

	appData.reviewDraft.forEach((c, index) => {
		const row = document.createElement("div");
		row.draggable = false;
		row.dataset.index = index;
		row.className =
			"flex flex-col sm:flex-row items-center gap-2.5 p-3.5 bg-white rounded-2xl border border-slate-200 transition-all";

		row.addEventListener("dragstart", (e) =>
			handleCourseDragStart(e, index, "draft"),
		);
		row.addEventListener("dragover", handleCourseDragOver);
		row.addEventListener("dragleave", handleCourseDragLeave);
		row.addEventListener("drop", (e) => handleCourseDrop(e, index, "draft"));
		row.addEventListener("dragend", handleCourseDragEnd);

		const marksVal = c.marks ?? c.grade ?? "";

		row.innerHTML = `
				<div
					class="drag-handle p-1.5 text-slate-400 hover:text-indigo-600 cursor-grab active:cursor-grabbing shrink-0 select-none"
					title="Hold and drag to reorder"
				>
					<i data-lucide="grip-vertical" class="w-4 h-4 pointer-events-none"></i>
				</div>
				<input
					value="${escapeHtml(c.code || "")}"
					onchange="updateDraftField(${index}, 'code', this.value)"
					placeholder="Code"
					class="border border-slate-200 rounded-xl px-3 py-2 text-sm w-full sm:w-32 font-mono uppercase"
				>
				<input
					value="${escapeHtml(c.name || "")}"
					onchange="updateDraftField(${index}, 'name', this.value)"
					placeholder="Subject / Course name"
					class="border border-slate-200 rounded-xl px-3 py-2 text-sm flex-1 w-full"
				>
				<input
					type="number"
					value="${c.credits ?? ""}"
					onchange="updateDraftField(${index}, 'credits', this.value === '' ? null : Number(this.value))"
					placeholder="Credits"
					class="border border-slate-200 rounded-xl px-3 py-2 text-sm w-full sm:w-24"
				>
				<input
					value="${escapeHtml(String(marksVal))}"
					onchange="updateDraftMarksAndAutoGp(${index}, this.value)"
					placeholder="Marks (e.g. 85/100)"
					class="border border-slate-200 rounded-xl px-3 py-2 text-sm w-full sm:w-36"
				>
				<input
					type="number"
					step="0.1"
					min="0"
					max="10"
					value="${c.gradePoint ?? ""}"
					onchange="updateDraftField(${index}, 'gradePoint', this.value === '' ? null : Number(this.value))"
					placeholder="GP (0-10)"
					class="border border-slate-200 rounded-xl px-3 py-2 text-sm w-full sm:w-28"
				>
				<button
					type="button"
					onclick="removeDraftRow(${index})"
					class="text-red-500 hover:text-red-700 text-sm font-semibold px-2.5 py-1.5"
				>
					Remove
				</button>
			`;

		const handle = row.querySelector(".drag-handle");
		handle.addEventListener("pointerdown", () => {
			activeDragHandleRow = row;
			row.draggable = true;
		});

		coursesCont.appendChild(row);
	});

	(appData.reviewTimetableDraft || []).forEach((t, index) => {
		if (!timetableCont) {
			return;
		}

		const row = document.createElement("div");
		row.className =
			"grid grid-cols-2 sm:grid-cols-6 gap-2.5 p-3.5 bg-slate-50/70 rounded-2xl border border-slate-200/80 text-sm";

		row.innerHTML = `
				<select
					onchange="updateDraftTimetableField(${index}, 'day', this.value)"
					class="border border-slate-200 bg-white rounded-xl px-2.5 py-2"
				>
					${["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
						.map(
							(d) => `<option ${t.day === d ? "selected" : ""}>${d}</option>`,
						)
						.join("")}
				</select>
				<input
					type="time"
					value="${t.start || ""}"
					onchange="updateDraftTimetableField(${index}, 'start', this.value)"
					class="border border-slate-200 bg-white rounded-xl px-2.5 py-2"
				>
				<input
					type="time"
					value="${t.end || ""}"
					onchange="updateDraftTimetableField(${index}, 'end', this.value)"
					class="border border-slate-200 bg-white rounded-xl px-2.5 py-2"
				>
				<input
					value="${escapeHtml(t.course || "")}"
					onchange="updateDraftTimetableField(${index}, 'course', this.value)"
					placeholder="Course"
					class="border border-slate-200 bg-white rounded-xl px-2.5 py-2"
				>
				<input
					value="${escapeHtml(t.room || "")}"
					onchange="updateDraftTimetableField(${index}, 'room', this.value)"
					placeholder="Room"
					class="border border-slate-200 bg-white rounded-xl px-2.5 py-2"
				>
				<button
					onclick="removeDraftTimetableRow(${index})"
					class="text-red-500 font-semibold"
				>
					Remove
				</button>
			`;

		timetableCont.appendChild(row);
	});

	(appData.reviewEventsDraft || []).forEach((ev, index) => {
		if (!eventsCont) {
			return;
		}

		const row = document.createElement("div");
		row.className =
			"grid grid-cols-1 sm:grid-cols-4 gap-2.5 p-3.5 bg-slate-50/70 rounded-2xl border border-slate-200/80 text-sm";

		row.innerHTML = `
				<input
					value="${escapeHtml(ev.title || "")}"
					onchange="updateDraftEventField(${index}, 'title', this.value)"
					placeholder="Event title"
					class="border border-slate-200 bg-white rounded-xl px-3 py-2"
				>
				<input
					type="date"
					value="${ev.date || ""}"
					onchange="updateDraftEventField(${index}, 'date', this.value)"
					class="border border-slate-200 bg-white rounded-xl px-3 py-2"
				>
				<select
					onchange="updateDraftEventField(${index}, 'type', this.value)"
					class="border border-slate-200 bg-white rounded-xl px-3 py-2"
				>
					<option ${ev.type === "Exam" ? "selected" : ""}>Exam</option>
					<option ${ev.type === "Submission" ? "selected" : ""}>Submission</option>
					<option ${ev.type === "Holiday" ? "selected" : ""}>Holiday</option>
					<option ${ev.type === "Other" ? "selected" : ""}>Other</option>
				</select>
				<button
					onclick="removeDraftEventRow(${index})"
					class="text-red-500 font-semibold"
				>
					Remove
				</button>
			`;

		eventsCont.appendChild(row);
	});

	if (typeof lucide !== "undefined") {
		lucide.createIcons();
	}
}

function updateDraftMarksAndAutoGp(index, rawMarks) {
	const item = appData.reviewDraft[index];
	if (!item) return;
	const trimmed = String(rawMarks || "").trim();
	item.marks = trimmed;
	item.grade = trimmed;
	const parsed = parseMarksExpression(trimmed);
	if (parsed.marks !== null) {
		item.gradePoint = marksToGradePoint10(parsed.marks, parsed.maxMarks);
	}
	renderParsedEditableReview();
}

function escapeHtml(value) {
	return String(value ?? "").replace(
		/[&<>'"]/g,
		(c) =>
			({
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				"'": "&#39;",
				'"': "&quot;",
			})[c],
	);
}

function updateDraftField(index, field, value) {
	if (appData.reviewDraft[index]) {
		appData.reviewDraft[index][field] = value;
	}
}

function updateDraftEventField(index, field, value) {
	if (appData.reviewEventsDraft?.[index]) {
		appData.reviewEventsDraft[index][field] = value;
	}
}

function updateDraftTimetableField(index, field, value) {
	if (appData.reviewTimetableDraft?.[index]) {
		appData.reviewTimetableDraft[index][field] = value;
	}
}

function addReviewItemRow() {
	appData.reviewDraft.push({
		code: "",
		name: "",
		credits: null,
		marks: "",
		gradePoint: null,
	});
	renderParsedEditableReview();
}

function addReviewEventRow() {
	if (!appData.reviewEventsDraft) {
		appData.reviewEventsDraft = [];
	}

	appData.reviewEventsDraft.push({
		id: Date.now(),
		title: "",
		date: null,
		type: "Other",
		confidence: 1,
	});

	renderParsedEditableReview();
}

function addReviewTimetableRow() {
	if (!appData.reviewTimetableDraft) {
		appData.reviewTimetableDraft = [];
	}

	appData.reviewTimetableDraft.push({
		day: "Monday",
		start: "",
		end: "",
		course: "",
		type: "Lecture",
		room: "",
	});

	renderParsedEditableReview();
}

function removeDraftRow(index) {
	appData.reviewDraft.splice(index, 1);
	renderParsedEditableReview();
}

let draggedCourseState = { index: null, listType: null };
let activeDragHandleRow = null;

window.addEventListener("mouseup", () => {
	if (activeDragHandleRow) {
		activeDragHandleRow.draggable = false;
		activeDragHandleRow = null;
	}
});

function handleCourseDragStart(e, index, listType) {
	if (activeDragHandleRow !== e.currentTarget) {
		e.preventDefault();
		return;
	}
	draggedCourseState = { index, listType };
	e.dataTransfer.effectAllowed = "move";
	e.currentTarget.classList.add("opacity-50", "border-indigo-400");
}

function handleCourseDragOver(e) {
	e.preventDefault();
	e.dataTransfer.dropEffect = "move";
	e.currentTarget.classList.add(
		"border-t-2",
		"border-t-indigo-500",
		"bg-indigo-50/30",
	);
}

function handleCourseDragLeave(e) {
	e.currentTarget.classList.remove(
		"border-t-2",
		"border-t-indigo-500",
		"bg-indigo-50/30",
	);
}

function handleCourseDragEnd(e) {
	e.currentTarget.draggable = false;
	activeDragHandleRow = null;
	e.currentTarget.classList.remove(
		"opacity-50",
		"border-indigo-400",
		"border-t-2",
		"border-t-indigo-500",
		"bg-indigo-50/30",
	);
}

function handleCourseDrop(e, targetIndex, listType) {
	e.preventDefault();
	e.currentTarget.classList.remove(
		"border-t-2",
		"border-t-indigo-500",
		"bg-indigo-50/30",
	);

	const { index: fromIndex, listType: fromList } = draggedCourseState;
	if (fromIndex === null || fromList !== listType || fromIndex === targetIndex)
		return;

	if (listType === "draft") {
		const [movedItem] = appData.reviewDraft.splice(fromIndex, 1);
		appData.reviewDraft.splice(targetIndex, 0, movedItem);
		renderParsedEditableReview();
	} else if (listType === "saved") {
		const [movedItem] = appData.courses.splice(fromIndex, 1);
		appData.courses.splice(targetIndex, 0, movedItem);
		localStorage.setItem("synapse_courses", JSON.stringify(appData.courses));
		renderCoursesTable();
		renderDashboardCourseNames();
		updateFocusCourseSelect();
	}

	draggedCourseState = { index: null, listType: null };
}

function removeDraftEventRow(index) {
	appData.reviewEventsDraft?.splice(index, 1);
	renderParsedEditableReview();
}

function removeDraftTimetableRow(index) {
	appData.reviewTimetableDraft?.splice(index, 1);
	renderParsedEditableReview();
}

function commitParsedSchedule() {
	const courses = appData.reviewDraft.filter(
		(c) => String(c.code || "").trim() && String(c.name || "").trim(),
	);

	const schedule = (appData.reviewTimetableDraft || []).filter(
		(t) =>
			t.day &&
			normaliseTime(t.start) &&
			normaliseTime(t.end) &&
			String(t.course || "").trim(),
	);

	const events = appData.reviewEventsDraft || [];

	if (!courses.length && !schedule.length && !events.length) {
		showToast("Nothing to save.", true);
		return;
	}

	const invalidEvent = events.find(
		(e) => e.type !== "Other" && (!isValidISODate(e.date) || !e.title),
	);

	if (invalidEvent) {
		showToast(
			"Every exam, submission and holiday needs a verified date in YYYY-MM-DD format.",
			true,
		);
		return;
	}

	if (courses.length > 0) {
		const existingByCode = new Map(
			(appData.courses || []).map((item) => [
				String(item.code || "").trim().toUpperCase(),
				item,
			]),
		);

		for (const c of courses) {
			const code = String(c.code).trim().toUpperCase();
			const prev = existingByCode.get(code) || {};
			const marksStr = String(c.marks ?? c.grade ?? "").trim();
			const parsedMarks = parseMarksExpression(marksStr);
			const gp =
				c.gradePoint !== null && c.gradePoint !== undefined && c.gradePoint !== ""
					? Number(c.gradePoint)
					: parsedMarks.marks !== null
						? marksToGradePoint10(parsedMarks.marks, parsedMarks.maxMarks)
						: prev.gradePoint ?? null;

			existingByCode.set(code, {
				...prev,
				...c,
				code,
				name: String(c.name).trim(),
				credits:
					c.credits !== null && c.credits !== undefined && c.credits !== ""
						? Number(c.credits)
						: prev.credits ?? null,
				grade: marksStr || prev.grade || null,
				gradePoint: gp,
			});
		}

		appData.courses = Array.from(existingByCode.values());
	}

	if (schedule.length > 0) {
		appData.timetable = {};

		for (const t of schedule) {
			if (!appData.timetable[t.day]) {
				appData.timetable[t.day] = [];
			}

			appData.timetable[t.day].push({
				time: `${t.start} - ${t.end}`,
				course: String(t.course).trim().toUpperCase(),
				type: t.type || "Other",
				room: t.room || "",
			});
		}
	}

	for (const ev of events) {
		if (ev.type === "Holiday" && ev.date) {
			indianCalendarData.customOverrides[ev.date] = {
				name: ev.title,
				type: "Imported Holiday",
				isOff: true,
			};
		} else if (ev.date) {
			appData.deadlines.push({
				id: ev.id || Date.now() + Math.random(),
				title: ev.title,
				course: ev.course || "",
				date: ev.date,
				type: ev.type,
				intensity: Number(ev.intensity) || 0,
				collision: false,
			});
		}
	}

	syncAllToFirestore();
	refreshDashboard();
	renderCalendar();

	showToast("Verified courses, marks & schedule saved!");
}

/* ================================================================
   COURSES & INLINE MANUAL GRADE CONTROL
   ================================================================ */

function addManualCourseRow() {
	const rawCode = prompt("Enter Course Code (e.g., CS301):");
	if (!rawCode || !rawCode.trim()) return;
	const code = rawCode.trim().toUpperCase();

	const rawName = prompt(`Enter Subject Name for ${code}:`);
	if (!rawName || !rawName.trim()) return;

	const rawCredits = prompt("Enter Credits (e.g., 4):", "4");
	const credits = rawCredits ? Number(rawCredits) : null;

	const rawMarks = prompt(
		"Enter Current Marks (optional, e.g. 84/100 or 84):",
		"",
	);
	const marksStr = String(rawMarks || "").trim();
	const parsed = parseMarksExpression(marksStr);
	const gp =
		parsed.marks !== null
			? marksToGradePoint10(parsed.marks, parsed.maxMarks)
			: null;

	const existingIndex = appData.courses.findIndex((c) => c.code === code);
	const entry = {
		code,
		name: rawName.trim(),
		credits: Number.isFinite(credits) && credits > 0 ? credits : null,
		lecsPerWeek: null,
		labsPerWeek: null,
		grade: marksStr || null,
		gradePoint: gp,
	};

	if (existingIndex >= 0) {
		appData.courses[existingIndex] = {
			...appData.courses[existingIndex],
			...entry,
		};
	} else {
		appData.courses.push(entry);
	}

	syncAllToFirestore();
	renderCoursesTable();
	refreshDashboard();
	showToast(`Saved ${code} (${entry.name}).`);
}

function updateCourseInline(index, field, rawValue) {
	const course = appData.courses[index];
	if (!course) return;

	if (field === "credits") {
		const num = rawValue === "" ? null : Number(rawValue);
		course.credits = Number.isFinite(num) && num >= 0 ? num : null;
	} else if (field === "grade") {
		const trimmed = String(rawValue || "").trim();
		course.grade = trimmed || null;
		const parsed = parseMarksExpression(trimmed);
		if (parsed.marks !== null) {
			course.gradePoint = marksToGradePoint10(parsed.marks, parsed.maxMarks);
		}
	} else if (field === "gradePoint") {
		const num = rawValue === "" ? null : Number(rawValue);
		course.gradePoint =
			Number.isFinite(num) && num >= 0 && num <= 10 ? num : null;
	}

	syncAllToFirestore();
	renderCoursesTable();
	refreshDashboard();
}

function renderCoursesTable() {
	const tbody = document.getElementById("coursesTableBody");
	if (!tbody) {
		return;
	}

	tbody.innerHTML = "";

	if (appData.courses.length === 0) {
		tbody.innerHTML = `
			<tr>
				<td
					colspan="8"
					class="text-center py-8 text-slate-400 text-sm"
				>
					No courses currently enrolled. Click <strong>Add Course / Grade</strong> above or upload a timetable/marksheet.
				</td>
			</tr>
		`;

		const gpa = document.getElementById("calculatedGpaDisplay");
		if (gpa) {
			gpa.innerHTML = `-- <span class="text-lg font-normal text-slate-400">/ 10.0</span>`;
		}

		const breakdown = document.getElementById("gpaCourseBreakdownText");
		if (breakdown) {
			breakdown.innerText = "Total Credits: 0";
		}

		const enrolled = document.getElementById("gpaEnrolledCount");
		if (enrolled) {
			enrolled.innerText = "0";
		}

		const metric = document.getElementById("metricGpa");
		if (metric) {
			metric.innerHTML = `-- <span class="text-sm text-slate-400 font-normal">/ 10</span>`;
		}

		const courseMetric = document.getElementById("metricCoursesCount");
		if (courseMetric) {
			courseMetric.innerText = "0 courses tracked";
		}

		return;
	}

	let totalCredits = 0;
	let totalGradePoints = 0;

	appData.courses.forEach((c, index) => {
		const credits = Number(c.credits) || 0;
		const gradePoint = Number(c.gradePoint);
		const hasValidGp =
			c.gradePoint !== null &&
			c.gradePoint !== undefined &&
			c.gradePoint !== "" &&
			Number.isFinite(gradePoint);

		if (credits > 0 && hasValidGp) {
			totalCredits += credits;
			totalGradePoints += credits * gradePoint;
		}

		const tr = document.createElement("tr");
		tr.draggable = false;
		tr.className = "hover:bg-slate-50/70 transition";

		tr.addEventListener("dragstart", (e) =>
			handleCourseDragStart(e, index, "saved"),
		);
		tr.addEventListener("dragover", handleCourseDragOver);
		tr.addEventListener("dragleave", handleCourseDragLeave);
		tr.addEventListener("drop", (e) => handleCourseDrop(e, index, "saved"));
		tr.addEventListener("dragend", handleCourseDragEnd);

		tr.innerHTML = `
				<td class="py-3.5 px-4 font-mono font-bold text-indigo-700">
					<div class="flex items-center gap-2">
						<span class="drag-handle text-slate-400 hover:text-indigo-600 cursor-grab active:cursor-grabbing select-none" title="Hold and drag to reorder">
							<i data-lucide="grip-vertical" class="w-4 h-4 pointer-events-none"></i>
						</span>
						<span>${escapeHtml(c.code || "")}</span>
					</div>
				</td>
				<td class="py-3.5 px-4 font-semibold text-slate-800">
					${escapeHtml(c.name || "")}
				</td>
				<td class="py-3.5 px-4 text-center">
					<input
						type="number"
						min="0"
						max="20"
						step="0.5"
						value="${c.credits ?? ""}"
						onchange="updateCourseInline(${index}, 'credits', this.value)"
						placeholder="Cr"
						class="w-16 text-center px-2 py-1 rounded-lg border border-slate-200 bg-slate-50/60 focus:bg-white focus:ring-2 focus:ring-indigo-500 text-sm font-bold text-slate-700"
					>
				</td>
				<td class="py-3.5 px-4 text-center text-slate-600">
					${c.lecsPerWeek ?? "--"}
				</td>
				<td class="py-3.5 px-4 text-center text-slate-600">
					${c.labsPerWeek ?? "--"}
				</td>
				<td class="py-3.5 px-4 text-center">
					<input
						type="text"
						value="${escapeHtml(String(c.grade ?? ""))}"
						onchange="updateCourseInline(${index}, 'grade', this.value)"
						placeholder="e.g. 85/100"
						class="w-28 text-center px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50/60 focus:bg-white focus:ring-2 focus:ring-indigo-500 text-sm font-semibold text-slate-800"
					>
				</td>
				<td class="py-3.5 px-4 text-center">
					<input
						type="number"
						min="0"
						max="10"
						step="0.1"
						value="${hasValidGp ? gradePoint : ""}"
						onchange="updateCourseInline(${index}, 'gradePoint', this.value)"
						placeholder="0-10"
						class="w-20 text-center px-2 py-1 rounded-lg border border-slate-200 bg-slate-50/60 focus:bg-white focus:ring-2 focus:ring-indigo-500 text-sm font-bold text-indigo-700"
					>
				</td>
				<td class="py-3.5 px-4 text-right">
					<button
						onclick="deleteCourse('${escapeHtml(c.code || "")}')"
						class="text-red-500 hover:text-red-700 p-1.5 rounded-lg hover:bg-red-50"
						title="Delete Course"
					>
						<i data-lucide="trash-2" class="w-4 h-4"></i>
					</button>
				</td>
			`;

		const handle = tr.querySelector(".drag-handle");
		handle.addEventListener("pointerdown", () => {
			activeDragHandleRow = tr;
			tr.draggable = true;
		});

		tbody.appendChild(tr);
	});

	const gpa = totalCredits > 0 ? totalGradePoints / totalCredits : null;
	const gpaDisplay = document.getElementById("calculatedGpaDisplay");

	if (gpaDisplay) {
		gpaDisplay.innerHTML =
			gpa === null
				? `-- <span class="text-lg font-normal text-slate-400">/ 10.0</span>`
				: `${gpa.toFixed(
						2,
					)} <span class="text-lg font-normal text-slate-400">/ 10.0</span>`;
	}

	const breakdown = document.getElementById("gpaCourseBreakdownText");
	if (breakdown) {
		breakdown.innerText = `Graded Credits: ${totalCredits}`;
	}

	const enrolled = document.getElementById("gpaEnrolledCount");
	if (enrolled) {
		enrolled.innerText = appData.courses.length;
	}

	const metric = document.getElementById("metricGpa");
	if (metric) {
		metric.innerHTML =
			gpa === null
				? `-- <span class="text-sm text-slate-400 font-normal">/ 10</span>`
				: `${gpa.toFixed(
						2,
					)} <span class="text-sm text-slate-400 font-normal">/ 10</span>`;
	}

	const courseMetric = document.getElementById("metricCoursesCount");
	if (courseMetric) {
		courseMetric.innerText = `${appData.courses.length} courses tracked`;
	}

	if (typeof lucide !== "undefined") {
		lucide.createIcons();
	}
}

async function deleteCourse(code) {
	if (!confirm(`Remove course ${code}?`)) {
		return;
	}

	appData.courses = appData.courses.filter((c) => c.code !== code);
	await deleteCloudDocument("courses", code);

	syncAllToFirestore();
	renderCoursesTable();
	refreshDashboard();

	showToast("Course removed.");
}

/* ================================================================
   CALENDAR
   ================================================================ */

function renderCalendar() {
	const grid = document.getElementById("calendarGrid");
	if (!grid) {
		return;
	}

	const year = appData.currentYear;
	const month = appData.currentMonth;
	const firstDay = new Date(year, month, 1).getDay();
	const daysInMonth = new Date(year, month + 1, 0).getDate();

	grid.innerHTML = "";

	for (let i = 0; i < firstDay; i++) {
		const blank = document.createElement("div");
		blank.className = "min-h-[96px]";
		grid.appendChild(blank);
	}

	for (let day = 1; day <= daysInMonth; day++) {
		const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(
			day,
		).padStart(2, "0")}`;

		const date = new Date(year, month, day);

		const dayNames = [
			"Sunday",
			"Monday",
			"Tuesday",
			"Wednesday",
			"Thursday",
			"Friday",
			"Saturday",
		];

		const dayName = dayNames[date.getDay()];
		const holiday = getDayFestivalInfo(dateStr);
		const dayClasses = appData.timetable[dayName] || [];
		const events = appData.deadlines.filter((d) => d.date === dateStr);

		const cell = document.createElement("div");
		const isToday = date.toDateString() === new Date().toDateString();

		cell.className = `min-h-[96px] p-2.5 border rounded-xl ${
			holiday?.isOff
				? "bg-blue-50 border-blue-100"
				: "bg-white border-slate-200/70"
		} ${isToday ? "ring-2 ring-indigo-500" : ""}`;

		let eventHTML = "";

		events.slice(0, 3).forEach((event) => {
			eventHTML += `
					<div class="mt-1 text-xs font-bold text-red-600 truncate">
						${escapeHtml(event.title)}
					</div>
				`;
		});

		if (holiday) {
			eventHTML += `
				<div class="mt-1 text-xs font-bold text-blue-600 truncate">
					${escapeHtml(holiday.name)}
				</div>
			`;
		}

		if (dayClasses.length) {
			eventHTML += `
				<div class="mt-1 text-xs text-slate-500">
					${dayClasses.length} class${dayClasses.length === 1 ? "" : "es"}
				</div>
			`;
		}

		cell.innerHTML = `
			<button
				class="w-full text-left"
				onclick="openDayDetail(
					${day},
					'${dateStr}',
					${dayClasses.length},
					'',
					${Boolean(holiday?.isOff)},
					${holiday ? "getDayFestivalInfo('" + dateStr + "')" : "null"}
				)"
			>
				<div class="flex items-center justify-between">
					<span class="text-sm font-bold ${
						isToday ? "text-indigo-600" : "text-slate-700"
					}">
						${day}
					</span>

					${
						isToday
							? `<span class="text-xs font-black text-indigo-600">TODAY</span>`
							: ""
					}
				</div>

				${eventHTML}
			</button>
		`;

		grid.appendChild(cell);
	}

	const monthLabel = document.getElementById("calendarCurrentMonthLabel");
	if (monthLabel) {
		monthLabel.innerText = new Date(year, month, 1).toLocaleString("default", {
			month: "long",
			year: "numeric",
		});
	}

	const monthSelect = document.getElementById("calendarMonthSelect");
	if (monthSelect) {
		monthSelect.value = String(month);
	}

	const yearInput = document.getElementById("calendarYearInput");
	if (yearInput) {
		yearInput.value = year;
	}

	if (typeof lucide !== "undefined") {
		lucide.createIcons();
	}
}

function changeCalendarMonth(delta) {
	appData.currentMonth += delta;

	if (appData.currentMonth > 11) {
		appData.currentMonth = 0;
		appData.currentYear++;
	} else if (appData.currentMonth < 0) {
		appData.currentMonth = 11;
		appData.currentYear--;
	}

	renderCalendar();
}

function onCalendarSelectChange() {
	const m = parseInt(document.getElementById("calendarMonthSelect").value, 10);
	const y = parseInt(document.getElementById("calendarYearInput").value, 10);

	if (!isNaN(m)) {
		appData.currentMonth = m;
	}

	if (!isNaN(y) && y >= 1990 && y <= 2100) {
		appData.currentYear = y;
	}

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

	if (!card) {
		return;
	}

	card.classList.remove("hidden");

	if (title) {
		title.innerText = `Breakdown for ${dateStr}`;
	}

	if (badge) {
		badge.innerText = isHoliday ? "Closed" : `${intensityHrs} Classes`;
		badge.className = `text-xs px-2.5 py-1 rounded-md font-bold ${
			isHoliday ? "bg-blue-100 text-blue-800" : "bg-indigo-100 text-indigo-800"
		}`;
	}

	if (content) {
		content.innerHTML = `
			<div class="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
				<div class="font-bold text-slate-800">
					${escapeHtml(eventTag || "Regular Academic Day")}
				</div>
				<p class="text-sm text-slate-600">
					${
						fest
							? `${escapeHtml(fest.name)} (${escapeHtml(fest.type)})`
							: isHoliday
								? "No scheduled lectures."
								: "Scheduled timetable applies."
					}
				</p>
			</div>
			<div class="flex items-center justify-between pt-2 border-t border-slate-100">
				<label class="flex items-center gap-2 cursor-pointer text-sm font-semibold text-slate-700">
					<input
						type="checkbox"
						id="overrideToggle_${dateStr}"
						${isHoliday ? "checked" : ""}
						onchange="toggleDateHolidayOverride('${dateStr}', this.checked)"
						class="rounded text-indigo-600"
					>
					<span>
						Mark as college holiday
					</span>
				</label>
				<button
					onclick="closeDayDetail()"
					class="text-sm text-slate-500"
				>
					Close
				</button>
			</div>
		`;
	}

	card.scrollIntoView({
		behavior: "smooth",
	});
}

function toggleDateHolidayOverride(dateStr, isOff) {
	indianCalendarData.customOverrides[dateStr] = {
		name: isOff
			? "College Holiday (Manual Override)"
			: "Working Day (Manual Override)",
		type: "User Override",
		isOff: isOff,
	};

	showToast(`Updated: ${dateStr}`);
	renderCalendar();
}

function closeDayDetail() {
	const card = document.getElementById("dayDetailCard");
	if (card) {
		card.classList.add("hidden");
	}
}

/* ================================================================
   AI LOAD LEVELING & REGULAR STUDY PLANNER
   ================================================================ */

function getEffectiveDailyStudyHours() {
	const raw = Number(appData.userProfile.dailyStudyHours);
	return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function triggerAiScheduleRebalance() {
	const capacity = getEffectiveDailyStudyHours();
	if (capacity <= 0) {
		showToast(
			"Set your available study hours/day in Profile & Semester first.",
			true,
		);
		switchView("profile");
		return;
	}

	const today = new Date();
	today.setHours(0, 0, 0, 0);

	const risks = calculateAcademicRisks().filter(
		(r) => r.level === "Critical" || r.level === "High" || r.level === "Moderate",
	);

	if (risks.length === 0) {
		showToast(
			"No high-load deadlines found. Use 'Generate Regular Plan' for daily course study blocks.",
		);
		return;
	}

	appData.tasks = appData.tasks.filter((t) => t.generatedBy !== "load-leveler");

	let createdBlocks = 0;

	for (const risk of risks) {
		let remaining = risk.effort;
		const maxOffset = Math.max(0, risk.days);

		for (let offset = maxOffset; offset >= 0 && remaining > 0; offset--) {
			const date = new Date(today);
			date.setDate(today.getDate() + offset);
			const iso = formatLocalISO(date);

			const existingHours = appData.tasks
				.filter((t) => t.date === iso && !t.done)
				.reduce((sum, t) => sum + parseHours(t.duration), 0);

			const available = Math.max(0, capacity - existingHours);
			const slot = Math.min(available, remaining);

			if (slot >= 0.25) {
				const roundedSlot = Math.round(slot * 10) / 10;
				appData.tasks.push({
					id: Date.now() + Math.random(),
					title: `Prep: ${risk.deadline.title}`,
					course: risk.deadline.course || "GENERAL",
					duration: `${roundedSlot} hrs`,
					done: false,
					date: iso,
					tag: "AI Load-Leveler",
					generatedBy: "load-leveler",
				});

				remaining = Math.max(0, remaining - roundedSlot);
				createdBlocks++;
			}
		}
	}

	syncAllToFirestore();
	refreshDashboard();
	renderPlannerView();

	if (createdBlocks > 0) {
		showToast(
			`Distributed ${createdBlocks} study block(s) across your available capacity.`,
		);
	} else {
		showToast(
			"Your daily study capacity is already full on all days leading up to these deadlines.",
			true,
		);
	}
}

function generateRegularStudyPlan(daysAhead = 7) {
	const capacity = getEffectiveDailyStudyHours();
	if (capacity <= 0) {
		showToast(
			"Set your available study hours/day in Profile & Semester first.",
			true,
		);
		switchView("profile");
		return;
	}

	if (!appData.courses || appData.courses.length === 0) {
		showToast("Add or import your courses first to build a study plan.", true);
		return;
	}

	appData.tasks = appData.tasks.filter((t) => t.generatedBy !== "regular-plan");

	const weightedCourses = appData.courses.map((c) => ({
		code: c.code || "COURSE",
		name: c.name || c.code || "Course",
		weight: Math.max(1, Number(c.credits) || 1),
	}));

	const today = new Date();
	today.setHours(0, 0, 0, 0);

	let courseCursor = 0;
	let createdBlocks = 0;

	for (let offset = 0; offset < daysAhead; offset++) {
		const date = new Date(today);
		date.setDate(today.getDate() + offset);
		const iso = formatLocalISO(date);

		const holiday = getDayFestivalInfo(iso);
		if (holiday?.isOff) continue;

		const existingHours = appData.tasks
			.filter((t) => t.date === iso && !t.done)
			.reduce((sum, t) => sum + parseHours(t.duration), 0);

		let freeHours = Math.max(0, capacity - existingHours);
		if (freeHours < 0.5) continue;

		const sessionsToday = freeHours >= 2 && weightedCourses.length > 1 ? 2 : 1;
		const slotHours = Math.round((freeHours / sessionsToday) * 10) / 10;

		for (let s = 0; s < sessionsToday && slotHours >= 0.5; s++) {
			const course = weightedCourses[courseCursor % weightedCourses.length];
			courseCursor++;

			appData.tasks.push({
				id: Date.now() + Math.random(),
				title: `Regular Study & Revision: ${course.name}`,
				course: course.code,
				duration: `${slotHours} hrs`,
				done: false,
				date: iso,
				tag: "Regular Plan",
				generatedBy: "regular-plan",
			});
			createdBlocks++;
		}
	}

	syncAllToFirestore();
	refreshDashboard();
	renderPlannerView();

	showToast(
		`Generated ${createdBlocks} balanced study blocks for the next ${daysAhead} days!`,
	);
}

function renderPlannerView() {
	const grid = document.getElementById("studyPlannerDaysGrid");
	if (!grid) {
		return;
	}

	const todayISO = getTodayISO();
	const capacity = getEffectiveDailyStudyHours();

	const upcomingTasks = (appData.tasks || [])
		.filter((t) => !isValidISODate(t.date) || t.date >= todayISO)
		.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

	if (upcomingTasks.length === 0) {
		grid.innerHTML = `
			<div class="md:col-span-3 bg-white rounded-3xl border border-dashed border-slate-300 p-8 text-center space-y-3">
				<i data-lucide="sparkles" class="w-10 h-10 mx-auto text-indigo-500"></i>
				<h4 class="font-bold text-slate-800 text-lg">No Study Blocks Scheduled Yet</h4>
				<p class="text-sm text-slate-500 max-w-md mx-auto">
					Click <strong>Generate Regular Plan</strong> to distribute your active courses across the next 7 days, or <strong>Rebalance High-Risk Load</strong> to split heavy exam/assignment prep.
				</p>
			</div>
		`;
		if (typeof lucide !== "undefined") lucide.createIcons();
		return;
	}

	const grouped = new Map();
	upcomingTasks.forEach((t) => {
		const key = isValidISODate(t.date) ? t.date : "Unscheduled";
		if (!grouped.has(key)) grouped.set(key, []);
		grouped.get(key).push(t);
	});

	grid.innerHTML = "";

	grouped.forEach((dayTasks, dateKey) => {
		const totalHours = dayTasks.reduce(
			(sum, t) => sum + parseHours(t.duration),
			0,
		);
		const isOverCap = capacity > 0 && totalHours > capacity;

		let dateLabel = dateKey;
		if (isValidISODate(dateKey)) {
			const [y, m, d] = dateKey.split("-").map(Number);
			const dt = new Date(y, m - 1, d);
			dateLabel =
				dateKey === todayISO
					? `Today • ${dt.toLocaleDateString("default", { month: "short", day: "numeric" })}`
					: dt.toLocaleDateString("default", {
							weekday: "short",
							month: "short",
							day: "numeric",
						});
		}

		const itemsHTML = dayTasks
			.map((t) => {
				const badgeStyle =
					t.generatedBy === "load-leveler"
						? "bg-amber-50 text-amber-800 border border-amber-200"
						: t.generatedBy === "regular-plan"
							? "bg-emerald-50 text-emerald-800 border border-emerald-200"
							: "bg-indigo-50 text-indigo-800 border border-indigo-200";
				return `
					<div class="p-3.5 rounded-2xl border ${t.done ? "bg-slate-50 border-slate-100 opacity-60" : "bg-slate-50/60 border-slate-200/80"} flex items-start justify-between gap-2 text-sm">
						<div class="flex items-start gap-2.5 overflow-hidden">
							<input
								type="checkbox"
								onchange="toggleTaskDone(${t.id}); renderPlannerView();"
								${t.done ? "checked" : ""}
								class="mt-1 w-4 h-4 rounded text-indigo-600 cursor-pointer shrink-0"
							>
							<div class="overflow-hidden">
								<div class="font-bold text-slate-800 truncate ${t.done ? "line-through text-slate-400" : ""}">
									${escapeHtml(t.title || "")}
								</div>
								<div class="text-xs text-slate-500 mt-0.5">
									${escapeHtml(t.course || "GENERAL")} • ${escapeHtml(t.duration || "")}
								</div>
							</div>
						</div>
						<span class="px-2.5 py-0.5 rounded-md text-xs font-bold shrink-0 ${badgeStyle}">
							${escapeHtml(t.tag || "Study")}
						</span>
					</div>
				`;
			})
			.join("");

		const card = document.createElement("div");
		card.className =
			"bg-white rounded-3xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between space-y-4";
		card.innerHTML = `
			<div class="space-y-3">
				<div class="flex items-center justify-between pb-3 border-b border-slate-100">
					<h4 class="font-bold text-slate-800 text-base">${escapeHtml(dateLabel)}</h4>
					<span class="text-xs px-2.5 py-0.5 rounded-full font-bold ${
						isOverCap
							? "bg-red-50 text-red-700 border border-red-200"
							: "bg-indigo-50 text-indigo-700 border border-indigo-100"
					}">
						${totalHours.toFixed(1)}h${capacity > 0 ? ` / ${capacity}h` : ""}
					</span>
				</div>
				<div class="space-y-2.5">${itemsHTML}</div>
			</div>
		`;

		grid.appendChild(card);
	});

	if (typeof lucide !== "undefined") {
		lucide.createIcons();
	}
}

/* ================================================================
   FOCUS TIMER
   ================================================================ */

function updateFocusCourseSelect() {
	const sel = document.getElementById("focusCourseSelect");
	if (!sel) {
		return;
	}

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
	if (sel) {
		sel.value = code;
	}

	setFocusMode(25, `${code} Focus`);
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
			b.classList.remove("bg-white", "shadow-sm", "text-indigo-600", "font-bold");
			b.classList.add("hover:text-slate-900");
		});

	const activeBtn = document.getElementById(`btn-mode-${minutes}`);
	if (activeBtn) {
		activeBtn.classList.add("bg-white", "shadow-sm", "text-indigo-600", "font-bold");
		activeBtn.classList.remove("hover:text-slate-900");
	}

	const label = document.getElementById("timerLabel");
	const buttonText = document.getElementById("timerBtnText");

	if (label) {
		label.innerText = `${modeLabel} Session`;
	}

	if (buttonText) {
		buttonText.innerText = "Start Focus";
	}

	updateTimerDisplay();
}

function updateTimerDisplay() {
	const mins = Math.floor(appData.focus.currentSeconds / 60);
	const secs = appData.focus.currentSeconds % 60;

	const display = document.getElementById("timerDisplay");
	if (display) {
		display.innerText = `${mins < 10 ? "0" + mins : mins}:${
			secs < 10 ? "0" + secs : secs
		}`;
	}
}

function toggleTimer() {
	if (appData.focus.isRunning) {
		clearInterval(appData.focus.timer);
		appData.focus.isRunning = false;

		const text = document.getElementById("timerBtnText");
		if (text) {
			text.innerText = "Resume Focus";
		}
	} else {
		appData.focus.isRunning = true;

		const text = document.getElementById("timerBtnText");
		if (text) {
			text.innerText = "Pause";
		}

		appData.focus.timer = setInterval(() => {
			if (appData.focus.currentSeconds > 0) {
				appData.focus.currentSeconds--;
				updateTimerDisplay();
			} else {
				clearInterval(appData.focus.timer);
				appData.focus.isRunning = false;

				playChime();
				appData.focus.completedSessions++;

				const count = document.getElementById("completedSessionsCount");
				if (count) {
					count.innerText = appData.focus.completedSessions;
				}

				if (text) {
					text.innerText = "Start Focus";
				}

				showToast("Focus session complete!");
			}
		}, 1000);
	}
}

function resetTimer() {
	clearInterval(appData.focus.timer);
	appData.focus.isRunning = false;
	appData.focus.currentSeconds = appData.focus.totalSeconds;

	const text = document.getElementById("timerBtnText");
	if (text) {
		text.innerText = "Start Focus";
	}

	updateTimerDisplay();
}

function playChime() {
	try {
		const synth = new Tone.PolySynth(Tone.Synth).toDestination();
		synth.triggerAttackRelease(["C5", "E5", "G5"], "4n");
	} catch (e) {
		console.log("Audio chime completed");
	}
}

/* ================================================================
   ADMIN
   ================================================================ */

async function fetchAdminDirectory() {
	const tbody = document.getElementById("adminUserTableBody");
	if (!tbody) {
		return;
	}

	tbody.innerHTML = `
		<tr>
			<td colspan="6" class="text-center py-4 text-slate-400">
				Loading directory...
			</td>
		</tr>
	`;

	if (!isFirebaseReady) {
		tbody.innerHTML = `
			<tr>
				<td class="py-3.5 px-4 font-mono font-bold text-slate-700">
					local-session
				</td>
				<td class="py-3.5 px-4">
					${escapeHtml(appData.userProfile.displayName || "Student")}
				</td>
				<td class="py-3.5 px-4">
					${escapeHtml(appData.userProfile.department || "Not set")}
				</td>
				<td class="py-3.5 px-4 text-center">
					${appData.userProfile.semester || "--"}
				</td>
				<td class="py-3.5 px-4 text-center">
					<span class="px-2.5 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-800">
						Local
					</span>
				</td>
				<td class="py-3.5 px-4 text-slate-400">
					Local Session
				</td>
			</tr>
		`;

		const totalUsers = document.getElementById("adminTotalUsers");
		if (totalUsers) {
			totalUsers.innerText = "1";
		}

		const totalCourses = document.getElementById("adminTotalCourses");
		if (totalCourses) {
			totalCourses.innerText = appData.courses.length;
		}

		return;
	}

	try {
		const snap = await db.collection("users").get();
		tbody.innerHTML = "";

		const totalUsers = document.getElementById("adminTotalUsers");
		if (totalUsers) {
			totalUsers.innerText = snap.size;
		}

		const totalCourses = document.getElementById("adminTotalCourses");
		if (totalCourses) {
			totalCourses.innerText = appData.courses.length;
		}

		snap.forEach((doc) => {
			const u = doc.data();
			const tr = document.createElement("tr");
			tr.className = "hover:bg-slate-50";

			tr.innerHTML = `
					<td class="py-3.5 px-4 font-mono text-slate-600">
						${escapeHtml(u.email || doc.id)}
					</td>
					<td class="py-3.5 px-4 font-bold text-slate-800">
						${escapeHtml(u.displayName || "Student")}
					</td>
					<td class="py-3.5 px-4 text-slate-600">
						${escapeHtml(u.department || "Not set")}
					</td>
					<td class="py-3.5 px-4 text-center">
						${u.semester || "--"}
					</td>
					<td class="py-3.5 px-4 text-center">
						<span class="px-2.5 py-0.5 rounded text-xs font-bold ${
							u.role === "admin"
								? "bg-amber-100 text-amber-800"
								: "bg-slate-100 text-slate-700"
						}">
							${u.role || "student"}
						</span>
					</td>
					<td class="py-3.5 px-4 text-slate-400">
						${
							u.createdAt
								? new Date(u.createdAt.seconds * 1000).toLocaleDateString()
								: "Recent"
						}
					</td>
				`;

			tbody.appendChild(tr);
		});
	} catch (e) {
		tbody.innerHTML = `
			<tr>
				<td
					colspan="6"
					class="text-center py-4 text-red-500 font-semibold"
				>
					Failed to fetch users:
					${escapeHtml(e.message)}
				</td>
			</tr>
		`;
	}
}

/* ================================================================
   BOOTSTRAP
   ================================================================ */

window.addEventListener("DOMContentLoaded", () => {
	try {
		const savedDeadlines = localStorage.getItem("synapse_deadlines");
		if (savedDeadlines) {
			appData.deadlines = JSON.parse(savedDeadlines);
		}

		const savedTasks = localStorage.getItem("synapse_tasks");
		if (savedTasks) {
			appData.tasks = JSON.parse(savedTasks);
		}

		const savedCourses = localStorage.getItem("synapse_courses");
		if (savedCourses) {
			appData.courses = JSON.parse(savedCourses);
		}

		const savedTimetable = localStorage.getItem("synapse_timetable");
		if (savedTimetable) {
			appData.timetable = JSON.parse(savedTimetable);
		}

		const savedProfile = localStorage.getItem("synapse_profile");
		if (savedProfile) {
			appData.userProfile = {
				...appData.userProfile,
				...JSON.parse(savedProfile),
			};
		}

		const savedHistory = localStorage.getItem("synapse_history");
		if (savedHistory) {
			appData.history = {
				...appData.history,
				...JSON.parse(savedHistory),
			};
		}

		const savedKey = localStorage.getItem("synapse_gemini_key");
		const keyInput = document.getElementById("geminiApiKeyInput");
		if (savedKey && keyInput) {
			keyInput.value = savedKey;
		}
	} catch (e) {
		console.warn("Local restore failed:", e);
	}

	refreshDashboard();
	renderCalendar();
	renderParsedEditableReview();
	updateTimerDisplay();

	if (typeof lucide !== "undefined") {
		lucide.createIcons();
	}
});