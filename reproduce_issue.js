const calculateDays = (startDate, endDate) => {
    if (!startDate || !endDate) return 0;

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (end < start) return 0;

    let days = 0;
    const current = new Date(start);

    console.log(`Start: ${start.toISOString()}`);
    console.log(`End: ${end.toISOString()}`);

    while (current <= end) {
        const dayOfWeek = current.getDay();
        console.log(`Checking ${current.toISOString()}, Day: ${dayOfWeek}`);
        // Count weekdays only (Monday = 1, Friday = 5)
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            days++;
        }
        current.setDate(current.getDate() + 1);
    }

    return days;
};

// Test Case 1: 19 Feb to 20 Feb 2026 (Thu-Fri)
// Expected: 2 days
const days = calculateDays('2026-02-19', '2026-02-20');
console.log(`Days calculated: ${days}`);
