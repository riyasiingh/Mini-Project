/* =====================================================================
   SYNAPSELOAD CENTRAL ENGINE (app.js)
   User-driven academic data + verified extraction
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
	const adminCheckbox = document.getElementById("authAdminCheckbox");

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

	if (adminCheckbox) {
		adminCheckbox.classList.toggle("hidden", !isSignUp);
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
			const adminInput = document.getElementById("authIsAdmin");

			const name = nameInput ? nameInput.value.trim() : "";
			const branch = branchInput ? branchInput.value.trim() : "";
			const sem = semesterInput ? parseInt(semesterInput.value, 10) : NaN;

			if (!name || !branch || !Number.isInteger(sem) || sem < 1 || sem > 12) {
				showToast("Enter your name, department and valid semester.", true);
				return;
			}

			const cred = await auth.createUserWithEmailAndPassword(email, password);

			const isAdmin = adminInput ? adminInput.checked : false;

			const profile = {
				uid: cred.user.uid,
				email: email,
				displayName: name,
				department: branch,
				semester: sem,
				role: isAdmin ? "admin" : "student",
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

async function toggleUserRole() {
	const currentRole = appData.userProfile.role || "student";

	const newRole = currentRole === "admin" ? "student" : "admin";

	appData.userProfile.role = newRole;

	if (isFirebaseReady && auth && auth.currentUser) {
		try {
			await db.collection("users").doc(auth.currentUser.uid).update({
				role: newRole,
			});
		} catch (e) {
			console.warn("Could not sync role to Firestore", e);
		}
	}

	updateUserDisplayUI();

	showToast(`Role set to: ${newRole.toUpperCase()}`);
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
   VIEW SWITCHER
   ================================================================ */

function switchView(viewName) {
	document
		.querySelectorAll(".view-panel")
		.forEach((panel) => panel.classList.add("hidden"));

	document.querySelectorAll(".nav-item").forEach((item) => {
		item.classList.remove("bg-indigo-600", "text-white", "shadow-sm");
		item.classList.add("hover:bg-slate-800", "text-slate-300");
	});

	const activePanel = document.getElementById("view-" + viewName);

	if (activePanel) {
		activePanel.classList.remove("hidden");
	}

	const activeNav = document.getElementById("nav-" + viewName);

	if (activeNav) {
		activeNav.classList.add("bg-indigo-600", "text-white", "shadow-sm");
		activeNav.classList.remove("hover:bg-slate-800", "text-slate-300");
	}

	const sidebar = document.getElementById("sidebarNav");

	if (sidebar) {
		sidebar.classList.add("-translate-x-full");
	}

	if (viewName === "calendar") {
		renderCalendar();
	}

	if (viewName === "courses") {
		renderCoursesTable();
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
		}
		toast.classList.add("border-red-500");
	} else {
		if (toastIcon) {
			toastIcon.setAttribute("data-lucide", "check-circle-2");
		}
		toast.classList.remove("border-red-500");
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
   PROFILE & SEMESTER
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
}

async function saveUserProfile() {
	const name = document.getElementById("profileNameInput")?.value.trim();
	const department = document.getElementById("profileDepartmentInput")?.value.trim();
	const semester = Number(document.getElementById("profileSemesterInput")?.value);
	const dailyStudyHours = Number(document.getElementById("profileStudyHoursInput")?.value);
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

	const archive = {
		profile: {
			...appData.userProfile,
		},
		courses: appData.courses,
		timetable: appData.timetable,
		deadlines: appData.deadlines,
		tasks: appData.tasks,
		archivedAt: new Date().toISOString(),
	};

	localStorage.setItem(archiveKey, JSON.stringify(archive));

	await clearAllUserData();

	appData.userProfile = {
		...appData.userProfile,
		semester: Number(appData.userProfile.semester) + 1,
		dailyStudyHours: null,
		saturdayRule: null,
	};

	populateProfileView();
	updateUserDisplayUI();

	showToast(
		`Semester ${appData.userProfile.semester} created. Add your new semester data.`,
	);
}

/* ================================================================
   DASHBOARD
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
				"inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-red-500/20 text-red-400 border border-red-500/30 font-bold";
			sideBadge.innerText = `${collisions.length} Risk!`;
			sideSummary.innerText = `Deadline: ${collisions[0].deadline.title}`;
		} else {
			banner.classList.add("hidden");
			navDot.className = "ml-auto w-2 h-2 rounded-full bg-slate-600";
			sideBadge.className =
				"inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-slate-700 text-slate-300 font-bold";
			sideBadge.innerText = "0 Active";
			sideSummary.innerText = "No high-risk workload detected";
		}
	}

	const metricCollisionCount = document.getElementById("metricCollisionCount");
	if (metricCollisionCount) {
		metricCollisionCount.innerText = `${collisions.length} Detected`;
	}

	const metricCollisionSubtext = document.getElementById("metricCollisionSubtext");
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
				<div class="p-6 text-center text-slate-400 border border-dashed border-slate-200 rounded-xl">
					<p class="text-xs">
						No classes added for today.
					</p>
				</div>
			`;
		} else {
			classes.forEach((c) => {
				const isLab = String(c.type || "").toLowerCase().includes("lab");
				const colorBg = isLab
					? "border-violet-200 bg-violet-50/40"
					: "border-slate-100 bg-slate-50/70";
				const badgeColor = isLab
					? "bg-violet-100 text-violet-700"
					: "bg-slate-200 text-slate-700";

				const el = document.createElement("div");
				el.className = `p-3 rounded-xl border ${colorBg} flex items-center justify-between text-xs transition hover:shadow-sm`;
				el.innerHTML = `
					<div class="flex items-center gap-3">
						<span class="font-mono text-slate-400 font-semibold text-[11px]">
							${escapeHtml(c.time || "")}
						</span>
						<div>
							<div class="font-bold text-slate-900">
								${escapeHtml(c.course || "")}
							</div>
							<div class="text-[11px] text-slate-500">
								${escapeHtml(c.room || "Room not specified")} • ${escapeHtml(c.type || "Class")}
							</div>
						</div>
					</div>
					<span class="px-2 py-0.5 rounded text-[10px] font-bold ${badgeColor}">
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
	renderTodoList();
	renderDeadlinesList();
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
			"p-3 rounded-xl border border-slate-200 bg-slate-50/60 flex flex-col justify-between text-center space-y-2";

		card.innerHTML = `
			<span class="text-xs font-bold text-slate-700 uppercase tracking-wider">
				${day}
			</span>
			<div class="flex items-center justify-center gap-1.5">
				<span class="w-2 h-2 rounded-full ${
					isSatOff ? "bg-blue-500" : "bg-emerald-500"
				}"></span>
				<span class="text-[11px] font-bold text-slate-800">
					${isSatOff ? "Holiday" : "Open"}
				</span>
			</div>
			<span class="text-[10px] text-slate-400 font-medium truncate block">
				${isSatOff ? "Weekend Buffer" : "Available capacity"}
			</span>
		`;

		grid.appendChild(card);
	});
}

/* ================================================================
   ROBUST CALENDAR & DATE NORMALIZER (Timezone Bug Fix)
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
	const y = target.getFullYear();
	const m = String(target.getMonth() + 1).padStart(2, "0");
	const d = String(target.getDate()).padStart(2, "0");
	el.value = `${y}-${m}-${d}`;
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
   MODAL-DRIVEN TASK WORKFLOW
   ================================================================ */

function renderTodoList() {
	const todoCont = document.getElementById("smartTodoList");
	if (!todoCont) {
		return;
	}

	todoCont.innerHTML = "";

	if (appData.tasks.length === 0) {
		todoCont.innerHTML = `
			<div class="p-6 text-center text-slate-400 border border-dashed border-slate-200 rounded-xl">
				<p class="text-xs">
					No study tasks. Add a task to schedule focused preparation.
				</p>
			</div>
		`;
		return;
	}

	appData.tasks.forEach((t) => {
		const div = document.createElement("div");
		div.className = `p-3 rounded-xl border ${
			t.done ? "bg-slate-50/60 border-slate-100" : "bg-white border-slate-200"
		} flex items-center justify-between text-xs`;

		div.innerHTML = `
			<div class="flex items-center gap-3 overflow-hidden">
				<input
					type="checkbox"
					onchange="toggleTaskDone(${t.id})"
					${t.done ? "checked" : ""}
					class="w-4 h-4 rounded text-indigo-600 cursor-pointer"
				>
				<div class="overflow-hidden">
					<div class="font-bold text-slate-800 truncate">
						${escapeHtml(t.title || "")}
					</div>
					<div class="text-[11px] text-slate-400">
						${escapeHtml(t.course || "")} • Est: ${escapeHtml(t.duration || "")} • ${escapeHtml(t.date || "")}
					</div>
				</div>
			</div>
			<div class="flex items-center gap-1 shrink-0">
				<button
					onclick="startFocusWithCourse('${escapeHtml(t.course || "GENERAL")}')"
					class="p-1.5 rounded-lg hover:bg-indigo-50 text-indigo-600"
					title="Focus"
				>
					<i data-lucide="play" class="w-3.5 h-3.5"></i>
				</button>
				<button
					onclick="editTaskPrompt(${t.id})"
					class="p-1.5 rounded-lg hover:bg-slate-100"
					title="Edit"
				>
					<i data-lucide="edit-2" class="w-3.5 h-3.5"></i>
				</button>
				<button
					onclick="deleteTask(${t.id})"
					class="p-1.5 rounded-lg hover:bg-red-50 text-red-500"
					title="Delete"
				>
					<i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
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

	const dateVal = isValidISODate(task.date) ? task.date : new Date().toISOString().slice(0, 10);
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
	const hours = parseFloat(document.getElementById("taskDurationInput")?.value) || 1.0;
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
	syncAllToFirestore();
}

async function deleteTask(taskId) {
	if (!confirm("Are you sure you want to delete this task?")) {
		return;
	}

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
			<div class="p-6 text-center text-slate-400 border border-dashed border-slate-200 rounded-xl">
				<p class="text-xs">
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
		div.className = `p-3 rounded-xl border flex items-center justify-between text-xs ${
			isRisk ? "border-red-200 bg-red-50/60" : "border-slate-200 bg-white"
		}`;

		div.innerHTML = `
			<div class="flex items-center gap-3 overflow-hidden">
				<div class="p-2 rounded-lg ${
					isRisk ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"
				} font-bold text-center min-w-[50px] shrink-0">
					<span class="block text-[10px] uppercase">
						${displayDate.toLocaleString("default", { month: "short" })}
					</span>
					<span class="text-sm font-black">
						${displayDate.getDate()}
					</span>
				</div>
				<div class="overflow-hidden">
					<div class="font-bold text-slate-800 truncate">
						${escapeHtml(d.title || "")}
					</div>
					<div class="text-slate-500 text-[11px] truncate">
						${escapeHtml(d.course || "")} • ${escapeHtml(d.type || "")} • ${d.intensity || 0}h Load
					</div>
				</div>
			</div>
			<div class="flex items-center gap-2 shrink-0 ml-2">
				${
					isRisk
						? `<span class="px-2 py-0.5 rounded text-[10px] font-black bg-red-600 text-white uppercase">
								Risk
						   </span>`
						: ""
				}
				<button
					onclick="editDeadlinePrompt(${d.id})"
					class="p-1.5 rounded-lg hover:bg-slate-100"
					title="Edit"
				>
					<i data-lucide="edit-2" class="w-3.5 h-3.5"></i>
				</button>
				<button
					onclick="deleteDeadline(${d.id})"
					class="p-1.5 rounded-lg hover:bg-red-50 text-red-500"
					title="Delete"
				>
					<i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
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
	if (intensityInput) intensityInput.value = parseHours(deadline.intensity) || 4.0;
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
	const course = document.getElementById("deadlineCourseSelect")?.value || "GENERAL";
	const type = document.getElementById("deadlineTypeSelect")?.value || "Assignment";
	const hours = parseFloat(document.getElementById("deadlineIntensityInput")?.value) || 3.0;
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
		const deadline = appData.deadlines.find((d) => String(d.id) === String(editId));
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

/* ================================================================
   EXTRACTION
   ================================================================ */

function saveGeminiApiKey(key) {
	if (key) {
		localStorage.setItem("synapse_gemini_key", key.trim());
		showToast("Vision API key saved locally.");
	}
}

async function handleFileUpload(event) {
	const file = event.target.files[0];
	if (!file) {
		return;
	}

	const badge = document.getElementById("ocrStatusBadge");
	if (badge) {
		badge.classList.remove("hidden");
	}

	showToast(`Processing "${file.name}"...`);

	try {
		const apiKey = localStorage.getItem("synapse_gemini_key") || "";

		if (apiKey) {
			await extractWithGeminiVision(file, apiKey);
		} else {
			await extractWithClientEngines(file);
		}
	} catch (err) {
		console.error("Extraction error:", err);
		showToast(`Extraction warning: ${err.message}`, true);
	} finally {
		if (badge) {
			badge.classList.add("hidden");
		}
	}
}

async function extractWithGeminiVision(file, apiKey) {
	const base64Data = await fileToBase64(file);
	const mimeType = file.type || "application/octet-stream";

	const promptText = `
You are a strict academic-document extraction engine.

Read ONLY information visibly present in the supplied document.

NEVER:
- guess
- infer
- autocomplete
- invent
- use today's date
- use example dates
- create missing timetable information

If a value is unclear or missing, return null.

Return ONLY valid JSON using this structure:

{
  "courses": [
    {
      "code": "string",
      "name": "string",
      "credits": number or null,
      "lecsPerWeek": number or null,
      "labsPerWeek": number or null,
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

Rules:

1. A course code must be explicitly visible.
2. A timetable row requires an explicitly visible day AND time.
3. An event without a clearly visible exact date MUST use null.
4. Never manufacture dates.
5. Never manufacture course codes.
6. Preserve document wording.
7. Keep timetable rows separate.
`;

	const requestBody = {
		contents: [
			{
				parts: [
					{
						text: promptText,
					},
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

	const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(
		apiKey,
	)}`;

	const res = await fetch(endpoint, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(requestBody),
	});

	if (!res.ok) {
		throw new Error(`Vision API error status ${res.status}`);
	}

	const data = await res.json();
	const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;

	if (!raw) {
		throw new Error("Vision engine returned no structured data.");
	}

	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error("Vision engine returned invalid JSON.");
	}

	setVerifiedDraft(parsed, file.name, "Gemini Vision");
}

function normaliseTime(value) {
	if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
		return null;
	}

	return value;
}

function validateExtractedData(parsed) {
	const coursesInput = Array.isArray(parsed?.courses) ? parsed.courses : [];
	const timetableInput = Array.isArray(parsed?.timetable) ? parsed.timetable : [];
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

	const codePattern = /^[A-Z]{2,8}[0-9]{1,4}[A-Z0-9-]*$/i;
	const courses = [];

	for (const c of coursesInput) {
		const code = String(c?.code || "").trim().toUpperCase();
		const confidence = Number(c?.confidence ?? 0);

		if (
			!code ||
			!codePattern.test(code) ||
			confidence < 0.65 ||
			courseCodes.has(code)
		) {
			continue;
		}

		courseCodes.add(code);

		courses.push({
			code,
			name: String(c?.name || "").trim(),
			credits: Number.isFinite(Number(c?.credits)) ? Number(c.credits) : null,
			lecsPerWeek: Number.isFinite(Number(c?.lecsPerWeek))
				? Number(c.lecsPerWeek)
				: null,
			labsPerWeek: Number.isFinite(Number(c?.labsPerWeek))
				? Number(c.labsPerWeek)
				: null,
			confidence,
			evidence: String(c?.evidence || ""),
		});
	}

	const timetable = timetableInput
		.filter((t) => {
			return (
				validDays.has(t?.day) &&
				normaliseTime(t?.start) &&
				normaliseTime(t?.end) &&
				String(t?.course || "").trim() &&
				Number(t?.confidence ?? 0) >= 0.65
			);
		})
		.map((t) => ({
			day: t.day,
			start: t.start,
			end: t.end,
			course: String(t.course).trim().toUpperCase(),
			type: ["Lecture", "Lab", "Tutorial", "Other"].includes(t.type)
				? t.type
				: "Other",
			room: t.room ? String(t.room).trim() : "",
			confidence: Number(t.confidence),
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
			confidence: Number(ev?.confidence ?? 0),
			evidence: String(ev?.evidence || ""),
		}))
		.filter((ev) => ev.title && ev.confidence >= 0.65);

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

	showToast(
		`Extracted ${clean.courses.length} courses, ${clean.timetable.length} timetable rows and ${clean.events.length} events. Verify before saving.`,
	);
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
	} else if (ext === "pdf" && typeof pdfjsLib !== "undefined") {
		const pdf = await pdfjsLib.getDocument({
			data: await file.arrayBuffer(),
		}).promise;

		for (let i = 1; i <= pdf.numPages; i++) {
			const page = await pdf.getPage(i);
			const content = await page.getTextContent();
			text += content.items.map((x) => x.str).join(" ") + "\n";
		}
	} else if (typeof Tesseract !== "undefined") {
		showToast("Processing document with local OCR...");
		const result = await Tesseract.recognize(file, "eng");
		text = result.data.text;
	} else {
		throw new Error("No supported extraction engine is available.");
	}

	parseDocumentLinesPure(text);
}

function parseDocumentLinesPure(text) {
	const lines = String(text || "")
		.split(/\r?\n/)
		.map((x) => x.trim())
		.filter(Boolean);

	const courses = [];
	const events = [];
	const seenCodes = new Set();

	const coursePattern = /\b([A-Z]{2,8}[0-9]{1,4}[A-Z0-9-]*)\b/i;
	const dateRegex = /\b(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})\b/;

	for (const line of lines) {
		const dateMatch = line.match(dateRegex);
		const eventWords =
			/(exam|mid.?sem|test|unit\s*test|insem|endsem|viva|quiz|submission|assignment|deadline|project|journal|presentation|holiday|vacation|break|recess)/i.test(
				line,
			);

		if (eventWords) {
			let iso = null;

			if (dateMatch) {
				const parts = dateMatch[1].split(/[\/.-]/);
				let year = parts[2];

				if (year.length === 2) {
					year = "20" + year;
				}

				const candidate = `${year}-${parts[1].padStart(
					2,
					"0",
				)}-${parts[0].padStart(2, "0")}`;

				if (isValidISODate(candidate)) {
					iso = candidate;
				}
			}

			events.push({
				id: Date.now() + events.length,
				title: line.slice(0, 80),
				date: iso,
				type: /holiday|vacation|break|recess/i.test(line)
					? "Holiday"
					: /exam|test|viva|quiz/i.test(line)
						? "Exam"
						: "Submission",
				effortHours: null,
				confidence: iso ? 0.78 : 0.55,
				evidence: line,
			});

			continue;
		}

		const match = line.match(coursePattern);
		if (!match) {
			continue;
		}

		const code = match[1].toUpperCase();

		if (
			/^(THE|AND|FOR|LAB|ROOM|TOTAL|WEEK|CODE|YEAR|HALL|SEM|TIME|DATE|DAY)[0-9]/i.test(
				code,
			)
		) {
			continue;
		}

		if (!seenCodes.has(code)) {
			seenCodes.add(code);
			const name = line
				.replace(match[0], "")
				.replace(/^[-:;,\s]+/, "")
				.trim();

			courses.push({
				code,
				name,
				credits: null,
				lecsPerWeek: null,
				labsPerWeek: null,
				confidence: name ? 0.72 : 0.66,
				evidence: line,
			});
		}
	}

	setVerifiedDraft(
		{
			courses,
			timetable: [],
			events,
		},
		"uploaded document",
		"Local text/OCR parser",
	);
}

/* ================================================================
   IMPORTER EDITOR
   ================================================================ */

function loadActiveCoursesIntoDraft() {
	if (appData.courses.length === 0) {
		showToast("No active courses stored.", true);
		return;
	}

	appData.reviewDraft = JSON.parse(JSON.stringify(appData.courses));

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
		row.className =
			"flex flex-col sm:flex-row gap-3 p-3 bg-white rounded-xl border";

		row.innerHTML = `
				<input
					value="${escapeHtml(c.code || "")}"
					onchange="updateDraftField(${index}, 'code', this.value)"
					placeholder="Course code"
					class="border rounded px-2 py-1"
				>
				<input
					value="${escapeHtml(c.name || "")}"
					onchange="updateDraftField(${index}, 'name', this.value)"
					placeholder="Course name"
					class="border rounded px-2 py-1 flex-1"
				>
				<input
					type="number"
					value="${c.credits ?? ""}"
					onchange="updateDraftField(${index}, 'credits', this.value === '' ? null : Number(this.value))"
					placeholder="Credits"
					class="border rounded px-2 py-1 w-24"
				>
				<button
					onclick="removeDraftRow(${index})"
					class="text-red-500"
				>
					Remove
				</button>
			`;

		coursesCont.appendChild(row);
	});

	(appData.reviewTimetableDraft || []).forEach((t, index) => {
		if (!timetableCont) {
			return;
		}

		const row = document.createElement("div");
		row.className =
			"grid grid-cols-2 sm:grid-cols-6 gap-2 p-3 bg-slate-50 rounded-xl border";

		row.innerHTML = `
				<select
					onchange="updateDraftTimetableField(${index}, 'day', this.value)"
					class="border rounded px-2 py-1"
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
					class="border rounded px-2 py-1"
				>
				<input
					type="time"
					value="${t.end || ""}"
					onchange="updateDraftTimetableField(${index}, 'end', this.value)"
					class="border rounded px-2 py-1"
				>
				<input
					value="${escapeHtml(t.course || "")}"
					onchange="updateDraftTimetableField(${index}, 'course', this.value)"
					placeholder="Course"
					class="border rounded px-2 py-1"
				>
				<input
					value="${escapeHtml(t.room || "")}"
					onchange="updateDraftTimetableField(${index}, 'room', this.value)"
					placeholder="Room"
					class="border rounded px-2 py-1"
				>
				<button
					onclick="removeDraftTimetableRow(${index})"
					class="text-red-500"
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
			"grid grid-cols-1 sm:grid-cols-4 gap-2 p-3 bg-slate-50 rounded-xl border";

		row.innerHTML = `
				<input
					value="${escapeHtml(ev.title || "")}"
					onchange="updateDraftEventField(${index}, 'title', this.value)"
					placeholder="Event title"
					class="border rounded px-2 py-1"
				>
				<input
					type="date"
					value="${ev.date || ""}"
					onchange="updateDraftEventField(${index}, 'date', this.value)"
					class="border rounded px-2 py-1"
				>
				<select
					onchange="updateDraftEventField(${index}, 'type', this.value)"
					class="border rounded px-2 py-1"
				>
					<option ${ev.type === "Exam" ? "selected" : ""}>Exam</option>
					<option ${ev.type === "Submission" ? "selected" : ""}>Submission</option>
					<option ${ev.type === "Holiday" ? "selected" : ""}>Holiday</option>
					<option ${ev.type === "Other" ? "selected" : ""}>Other</option>
				</select>
				<button
					onclick="removeDraftEventRow(${index})"
					class="text-red-500"
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

	appData.courses = courses.map((c) => ({
		...c,
		code: String(c.code).trim().toUpperCase(),
	}));

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

	showToast("Verified user data saved.");
}

/* ================================================================
   COURSES
   ================================================================ */

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
					class="text-center py-8 text-slate-400"
				>
					No courses currently enrolled.
					Upload your own timetable to extract them.
				</td>
			</tr>
		`;

		const gpa = document.getElementById("calculatedGpaDisplay");
		if (gpa) {
			gpa.innerHTML = `-- <span class="text-lg font-normal text-indigo-300">/ 10.0</span>`;
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
			metric.innerHTML = `-- <span class="text-xs text-slate-400 font-normal">/ 10</span>`;
		}

		const courseMetric = document.getElementById("metricCoursesCount");
		if (courseMetric) {
			courseMetric.innerText = "0 courses tracked";
		}

		return;
	}

	let totalCredits = 0;
	let totalGradePoints = 0;

	appData.courses.forEach((c) => {
		const credits = Number(c.credits) || 0;
		const gradePoint = Number(c.gradePoint) || 0;

		totalCredits += credits;
		totalGradePoints += credits * gradePoint;

		const tr = document.createElement("tr");
		tr.className = "hover:bg-slate-50/70 transition";

		tr.innerHTML = `
				<td class="py-3 px-4 font-mono font-bold text-indigo-700">
					${escapeHtml(c.code || "")}
				</td>
				<td class="py-3 px-4 font-semibold text-slate-800">
					${escapeHtml(c.name || "")}
				</td>
				<td class="py-3 px-4 text-center">
					<span class="px-2 py-0.5 rounded-full bg-slate-100 font-bold text-slate-700">
						${credits || "--"} Cr
					</span>
				</td>
				<td class="py-3 px-4 text-center text-slate-600">
					${c.lecsPerWeek ?? "--"}
				</td>
				<td class="py-3 px-4 text-center text-slate-600">
					${c.labsPerWeek ?? "--"}
				</td>
				<td class="py-3 px-4 text-center">
					${c.grade ?? "--"}
				</td>
				<td class="py-3 px-4 text-center">
					${c.gradePoint ?? "--"}
				</td>
				<td class="py-3 px-4 text-right">
					<button
						onclick="deleteCourse('${escapeHtml(c.code || "")}')"
						class="text-red-500 hover:text-red-700"
					>
						<i data-lucide="trash-2" class="w-4 h-4"></i>
					</button>
				</td>
			`;

		tbody.appendChild(tr);
	});

	const gpa = totalCredits > 0 ? totalGradePoints / totalCredits : null;
	const gpaDisplay = document.getElementById("calculatedGpaDisplay");

	if (gpaDisplay) {
		gpaDisplay.innerHTML =
			gpa === null
				? `-- <span class="text-lg font-normal text-indigo-300">/ 10.0</span>`
				: `${gpa.toFixed(
						2,
					)} <span class="text-lg font-normal text-indigo-300">/ 10.0</span>`;
	}

	const breakdown = document.getElementById("gpaCourseBreakdownText");
	if (breakdown) {
		breakdown.innerText = `Total Credits: ${totalCredits}`;
	}

	const enrolled = document.getElementById("gpaEnrolledCount");
	if (enrolled) {
		enrolled.innerText = appData.courses.length;
	}

	const metric = document.getElementById("metricGpa");
	if (metric) {
		metric.innerHTML =
			gpa === null
				? `-- <span class="text-xs text-slate-400 font-normal">/ 10</span>`
				: `${gpa.toFixed(
						2,
					)} <span class="text-xs text-slate-400 font-normal">/ 10</span>`;
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
		blank.className = "min-h-[90px]";
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

		cell.className = `min-h-[90px] p-2 border rounded-xl ${
			holiday?.isOff
				? "bg-blue-50 border-blue-100"
				: "bg-white border-slate-200"
		} ${isToday ? "ring-2 ring-indigo-400" : ""}`;

		let eventHTML = "";

		events.slice(0, 3).forEach((event) => {
			eventHTML += `
					<div class="mt-1 text-[9px] font-bold text-red-600 truncate">
						${escapeHtml(event.title)}
					</div>
				`;
		});

		if (holiday) {
			eventHTML += `
				<div class="mt-1 text-[9px] font-bold text-blue-600 truncate">
					${escapeHtml(holiday.name)}
				</div>
			`;
		}

		if (dayClasses.length) {
			eventHTML += `
				<div class="mt-1 text-[9px] text-slate-500">
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
					<span class="text-xs font-bold ${
						isToday ? "text-indigo-600" : "text-slate-700"
					}">
						${day}
					</span>

					${
						isToday
							? `<span class="text-[8px] font-black text-indigo-500">TODAY</span>`
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
			<div class="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
				<div class="font-bold text-slate-800">
					${escapeHtml(eventTag || "Regular Academic Day")}
				</div>
				<p class="text-xs text-slate-600">
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
				<label class="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
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
					class="text-xs text-slate-500"
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
   AI LOAD LEVELING
   ================================================================ */

function triggerAiScheduleRebalance() {
	const risks = calculateAcademicRisks().filter(
		(r) => r.level === "Critical" || r.level === "High",
	);

	if (risks.length === 0) {
		showToast("No high-risk deadline needs load-leveling.");
		return;
	}

	const capacity = Number(appData.userProfile.dailyStudyHours);

	if (!Number.isFinite(capacity) || capacity <= 0) {
		showToast(
			"Set your available study hours/day in your profile first.",
			true,
		);
		return;
	}

	appData.tasks = appData.tasks.filter((t) => t.generatedBy !== "load-leveler");

	for (const risk of risks) {
		let remaining = risk.effort;

		for (
			let offset = Math.max(0, risk.days - 1);
			offset >= 0 && remaining > 0;
			offset--
		) {
			const date = new Date();
			date.setHours(0, 0, 0, 0);
			date.setDate(date.getDate() + offset);

			const iso = date.toISOString().slice(0, 10);
			const existing = appData.tasks
				.filter((t) => t.date === iso && !t.done)
				.reduce((sum, t) => sum + parseHours(t.duration), 0);

			const available = Math.max(0, capacity - existing);
			const slot = Math.min(available, remaining);

			if (slot > 0) {
				appData.tasks.push({
					id: Date.now() + Math.random(),
					title: `Preparation: ${risk.deadline.title}`,
					course: risk.deadline.course || "",
					duration: `${slot.toFixed(1)} hr`,
					done: false,
					date: iso,
					tag: "AI Load-Leveler",
					generatedBy: "load-leveler",
				});

				remaining -= slot;
			}
		}
	}

	syncAllToFirestore();
	renderTodoList();

	showToast("Study blocks were distributed into earlier available capacity.");
}

function renderPlannerView() {
	const grid = document.getElementById("studyPlannerDaysGrid");
	if (!grid) {
		return;
	}

	grid.innerHTML = `
		<div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
			<div class="flex items-center justify-between pb-3 border-b border-slate-100">
				<h4 class="font-bold text-slate-800 text-sm">
					Study Blocks
				</h4>
				<span class="text-xs px-2 py-0.5 rounded font-bold bg-indigo-100 text-indigo-800">
					Capacity Based
				</span>
			</div>
			<p class="text-xs text-slate-500">
				Study blocks generated by the workload engine will appear here.
			</p>
		</div>
	`;
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
			b.classList.remove("bg-white", "shadow-sm", "text-indigo-600");
			b.classList.add("hover:text-slate-900");
		});

	const activeBtn = document.getElementById(`btn-mode-${minutes}`);
	if (activeBtn) {
		activeBtn.classList.add("bg-white", "shadow-sm", "text-indigo-600");
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
				<td class="py-3 px-4 font-mono font-bold text-slate-700">
					local-session
				</td>
				<td class="py-3 px-4">
					${escapeHtml(appData.userProfile.displayName || "Student")}
				</td>
				<td class="py-3 px-4">
					${escapeHtml(appData.userProfile.department || "Not set")}
				</td>
				<td class="py-3 px-4 text-center">
					${appData.userProfile.semester || "--"}
				</td>
				<td class="py-3 px-4 text-center">
					<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
						Local
					</span>
				</td>
				<td class="py-3 px-4 text-slate-400">
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
					<td class="py-3 px-4 font-mono text-slate-600">
						${escapeHtml(u.email || doc.id)}
					</td>
					<td class="py-3 px-4 font-bold text-slate-800">
						${escapeHtml(u.displayName || "Student")}
					</td>
					<td class="py-3 px-4 text-slate-600">
						${escapeHtml(u.department || "Not set")}
					</td>
					<td class="py-3 px-4 text-center">
						${u.semester || "--"}
					</td>
					<td class="py-3 px-4 text-center">
						<span class="px-2 py-0.5 rounded text-[10px] font-bold ${
							u.role === "admin"
								? "bg-amber-100 text-amber-800"
								: "bg-slate-100 text-slate-700"
						}">
							${u.role || "student"}
						</span>
					</td>
					<td class="py-3 px-4 text-slate-400">
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
