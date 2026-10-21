// Jalali (Solar Hijri / Shamsi) <-> Gregorian conversion.
// Algorithm based on the well-known Jalaali / Birashk approach.
// Exposes window.Jalali with pure date conversion + helpers.

(function () {
  'use strict';

  // Integer division that truncates toward zero (matches canonical Jalaali algorithm).
  // Math.floor would be wrong for negative numerators (e.g. div(-3, 6) must be 0, not -1).
  function div(a, b) { return Math.trunc(a / b); }

  // Returns { leap, gy, march } where march is the day in March on which Farvardin 1 falls.
  function jalCal(jy) {
    var breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181,
                  1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
    var bl = breaks.length;
    var gy = jy + 621;
    var leapJ = -14;
    var jp = breaks[0];
    if (jy < jp || jy >= breaks[bl - 1]) throw new Error('Invalid Jalali year ' + jy);
    var jump = 0, jm, n, leap;
    for (var i = 1; i < bl; i++) {
      jm = breaks[i];
      jump = jm - jp;
      if (jy < jm) break;
      leapJ = leapJ + div(jump, 33) * 8 + div((jump % 33), 4);
      jp = jm;
    }
    n = jy - jp;
    leapJ = leapJ + div(n, 33) * 8 + div(((n % 33) + 3), 4);
    if ((jump % 33) === 4 && jump - n === 4) leapJ += 1;
    var leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
    var march = 20 + leapJ - leapG;
    if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
    leap = (((n + 1) % 33) - 1) % 4;
    if (leap === -1) leap = 4;
    return { leap: leap, gy: gy, march: march };
  }

  function isLeapJalali(jy) { return jalCal(jy).leap === 0; }

  function j2d(jy, jm, jd) {
    var r = jalCal(jy);
    return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
  }

  function d2j(jdn) {
    var gy = d2g(jdn).gy;
    var jy = gy - 621;
    var r = jalCal(jy);
    var jdn1f = g2d(gy, 3, r.march);
    var k = jdn - jdn1f;
    if (k >= 0) {
      if (k <= 185) return { jy: jy, jm: 1 + div(k, 31), jd: (k % 31) + 1 };
      else { k -= 186; }
    } else {
      jy -= 1;
      k += 179;
      if (r.leap === 1) k += 1;
    }
    return { jy: jy, jm: 7 + div(k, 30), jd: (k % 30) + 1 };
  }

  function g2d(gy, gm, gd) {
    var d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4)
          + div(153 * ((gm + 9) % 12) + 2, 5)
          + gd - 34840408;
    d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
    return d;
  }

  function d2g(jdn) {
    var j = 4 * jdn + 139361631;
    j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
    var i = div((j % 1461), 4) * 5 + 308;
    var gd = div((i % 153), 5) + 1;
    var gm = ((div(i, 153)) % 12) + 1;
    var gy = div(j, 1461) - 100100 + div(8 - gm, 6);
    return { gy: gy, gm: gm, gd: gd };
  }

  // Convert a JS Date (local time) to Jalali { jy, jm, jd }
  function gregorianToJalali(date) {
    var jdn = g2d(date.getFullYear(), date.getMonth() + 1, date.getDate());
    return d2j(jdn);
  }

  // Convert Jalali to JS Date at local midnight
  function jalaliToGregorian(jy, jm, jd) {
    var r = d2g(j2d(jy, jm, jd));
    return new Date(r.gy, r.gm - 1, r.gd);
  }

  function jLength(jy, jm) {
    if (jm <= 6) return 31;
    if (jm <= 11) return 30;
    return isLeapJalali(jy) ? 30 : 29;
  }
  function gLength(gy, gm) {
    var d = new Date(gy, gm, 0);
    return d.getDate();
  }

  var jMonths = ['Farvardin','Ordibehesht','Khordad','Tir','Mordad','Shahrivar',
                 'Mehr','Aban','Azar','Dey','Bahman','Esfand'];
  var gMonths = ['January','February','March','April','May','June',
                 'July','August','September','October','November','December'];
  var dowShort = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  // Format a JS Date as Jalali yyyy/mm/dd
  function formatJalali(date) {
    var j = gregorianToJalali(date);
    return j.jy + '/' + pad(j.jm) + '/' + pad(j.jd);
  }
  function formatGregorian(date) {
    return date.getFullYear() + '/' + pad(date.getMonth() + 1) + '/' + pad(date.getDate());
  }

  // Parse "yyyy/mm/dd" or "yyyy-mm-dd" Jalali. Returns Date or null.
  function parseJalali(str) {
    if (!str) return null;
    var m = String(str).trim().match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (!m) return null;
    var jy = +m[1], jm = +m[2], jd = +m[3];
    if (jm < 1 || jm > 12) return null;
    if (jd < 1 || jd > jLength(jy, jm)) return null;
    return jalaliToGregorian(jy, jm, jd);
  }
  function parseGregorian(str) {
    if (!str) return null;
    var m = String(str).trim().match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (!m) return null;
    var gy = +m[1], gm = +m[2], gd = +m[3];
    if (gm < 1 || gm > 12) return null;
    if (gd < 1 || gd > gLength(gy, gm)) return null;
    return new Date(gy, gm - 1, gd);
  }

  // Returns array of cells for a Jalali month grid (Sun-first), null for blanks.
  function jalaliMonthGrid(jy, jm) {
    var firstDate = jalaliToGregorian(jy, jm, 1);
    var startDow = firstDate.getDay(); // 0=Sun
    var daysInMonth = jLength(jy, jm);
    var cells = [];
    for (var i = 0; i < startDow; i++) cells.push(null);
    for (var d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }
  function gregorianMonthGrid(gy, gm) {
    var firstDate = new Date(gy, gm - 1, 1);
    var startDow = firstDate.getDay();
    var daysInMonth = gLength(gy, gm);
    var cells = [];
    for (var i = 0; i < startDow; i++) cells.push(null);
    for (var d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }

  function isoFromDate(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }
  function dateFromIso(iso) {
    if (!iso) return null;
    var p = iso.split('T')[0].split('-');
    if (p.length < 3) return null;
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
  }

  // Returns ISO week start (Sunday-based here, to match the calendar grid)
  function startOfWeek(date) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() - d.getDay());
    return d;
  }
  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }
  function addDays(date, n) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() + n);
    return d;
  }
  function addMonths(date, n) {
    return new Date(date.getFullYear(), date.getMonth() + n, 1);
  }

  window.Jalali = {
    gregorianToJalali: gregorianToJalali,
    jalaliToGregorian: jalaliToGregorian,
    formatJalali: formatJalali,
    formatGregorian: formatGregorian,
    parseJalali: parseJalali,
    parseGregorian: parseGregorian,
    jalaliMonthGrid: jalaliMonthGrid,
    gregorianMonthGrid: gregorianMonthGrid,
    jLength: jLength,
    gLength: gLength,
    jMonths: jMonths,
    gMonths: gMonths,
    dowShort: dowShort,
    isoFromDate: isoFromDate,
    dateFromIso: dateFromIso,
    sameDay: sameDay,
    startOfWeek: startOfWeek,
    startOfMonth: startOfMonth,
    addDays: addDays,
    addMonths: addMonths,
    pad: pad
  };
})();
