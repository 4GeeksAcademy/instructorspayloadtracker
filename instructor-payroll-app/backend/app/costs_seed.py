"""
Costs Hub seed: June-September 2026 history + October/November 2026 projections.

Run as part of `python -m app.seed` (idempotent: a month is only seeded when
it has no cost lines yet, so it never duplicates or overwrites edits).

Sources
- Team & contractors (section "people"): the monthly payroll sheets Marcelo
  shared (Jun, Jul, Aug, Sep 2026). Sheet rows marked "Por pagar" belong to
  past months and were paid -> stored as Pagado. "Iberoamerica Paga" rows are
  stored with paid_by = Iberoamérica so they don't count as USA cost.
  People who are instructors (they live in the Instructors section) are NOT
  copied here, so nobody is counted twice.
- Everything else (marketing, tech, operations, W-2 payroll, founders, debt,
  taxes, Spain reimbursements, and an instructor total for months with no
  rows in the Instructors section): Bank of America statements Jun-Sep 2026,
  categorized line by line. Bank lines are by PAYMENT month.
- October: September's team copied (Daniela Maestre left Sep 30), plus the
  budget agreed on Oct 14-19: marketing USA $15k / LATAM $5k (paid by LATAM)
  / Spain $30k (paid by Spain), W-2 payroll $12.5k + $3.3k taxes, founders
  $18k, the new Libertas advance, Tigre on schedule, IRS $2k, cards $3k.
  Everything is a projection until confirmed.
- November: a copy of October (projection).
"""
from datetime import date
from decimal import Decimal

from app.models.models import CostEntry, PayPeriod

MONTHS = {
    6: ("June 2026", date(2026, 6, 1), date(2026, 6, 30)),
    7: ("July 2026", date(2026, 7, 1), date(2026, 7, 31)),
    8: ("August 2026", date(2026, 8, 1), date(2026, 8, 31)),
    9: ("September 2026", date(2026, 9, 1), date(2026, 9, 30)),
    10: ("October 2026", date(2026, 10, 1), date(2026, 10, 31)),
    11: ("November 2026", date(2026, 11, 1), date(2026, 11, 30)),
}

IBERO = "Iberoamérica paga"

# (division, rol o departamento, nombre completo, monto, status, metodo, frecuencia)
SHEETS = {
    6: [
        ("HQ", "Staff", "Ariana Sánchez", 2286.40, "Pagado", "ACH", "8 de cada mes"),
        ("Latam", "Marketing", "Génesis CM", 851.00, IBERO, "Cash", "30 de cada mes, Iberoamérica paga"),
        ("HQ", "Staff", "Kevin - Contabilidad", 600.00, "Pagado", "ACH", "10 de cada mes"),
        ("Spain", "Marketing", "Edgar Navarro", 200.00, IBERO, "ACH", "Iberoamérica paga"),
        ("Latam", "Marketing", "Yerden", 1110.00, IBERO, "Cash", "Iberoamérica paga"),
        ("Latam", "Staff", "Paula Fernandez", 4445.00, IBERO, "Zelle", "Iberoamérica paga"),
        ("Latam", "Staff", "Valentina Ancieta", 3000.00, "Pagado", "ACH - BoFa", "8 de cada mes"),
        ("HQ", "Staff", "Lorena Gubaira", 620.00, "Pagado", "Melio", "03 de cada mes"),
        ("HQ", "Brand Content Lead", "Anik Meijer-Werner", 1350.00, "Pagado", "ACH", "30 de cada mes"),
        ("HQ", "Office Assistant", "Andreina Daher", 901.00, IBERO, "Zelle", "Iberoamérica paga"),
        ("Latam", "Admission Latam", "Marcia Elias de Ancieta", 1024.00, IBERO, "Zelle", "Iberoamérica paga"),
        ("HQ", "Developer", "Luis Miguel", 1800.00, "Pagado", "Transferwise", "03 de cada mes"),
        ("HQ", "Career Support HQ", "Daniela Maestre", 1340.00, IBERO, "ACH", "Iberoamérica paga"),
        ("HQ", "Junior Growth Engineer", "Alejandro Mauricio Jimenez Morales", 500.00, "Pagado", "ACH", "30 de cada mes"),
        ("HQ", "Staff", "Camila Allegri", 366.67, "Pagado", "ACH", "30 de cada mes"),
        ("HQ", "Community Specialist", "Carlos Avila", 650.00, "Pagado", "ACH - BoFa", "30 de cada mes"),
        ("HQ", "Career Support para Campus", "Fabiana Pereira", 920.00, "Pagado", "ACH", "30 de cada mes"),
        ("USA", "Program Manager USA", "Loreto Concha", 1300.00, "Pagado", "ACH", "30 de cada mes"),
        ("HQ", "Career Support Coach", "Guiseppe Cesaano", 1275.00, IBERO, "ACH", "Iberoamérica paga"),
        ("HQ", "Culture and Talent Specialist", "Viviana Niño", 400.00, "Pagado", "Zelle", "30 de cada mes"),
        ("HQ", "Staff", "Andrés Izquierdo", 200.00, "Pagado", "Zelle", "30 de cada mes"),
    ],
    7: [
        ("HQ", "Staff", "Ariana Sánchez", 2310.60, "Pagado", "ACH", "8 de cada mes"),
        ("HQ", "Staff", "Kevin - Contabilidad", 600.00, "Pagado", "ACH", "10 de cada mes"),
        ("Latam", "Staff", "Valentina Ancieta", 3060.00, "Pagado", "ACH - BoFa", "8 de cada mes"),
        ("HQ", "Staff", "Lorena Gubaira", 620.00, "Pagado", "Melio", "03 de cada mes"),
        ("HQ", "Brand Content Lead", "Anik Meijer-Werner", 1350.00, "Pagado", "ACH", "30 de cada mes"),
        ("HQ", "Developer", "Luis Miguel", 1800.00, "Pagado", "Transferwise", "03 de cada mes"),
        ("HQ", "Junior Growth Engineer", "Alejandro Mauricio Jimenez Morales", 500.00, "Pagado", "ACH", "30 de cada mes"),
        ("HQ", "Community Specialist", "Carlos Avila", 650.00, "Pagado", "ACH - BoFa", "30 de cada mes"),
        ("HQ", "Career Support para Campus", "Fabiana Pereira", 980.00, "Pagado", "ACH", "30 de cada mes"),
        ("USA", "Program Manager USA", "Loreto Concha", 1600.00, "Pagado", "ACH", "30 de cada mes"),
        ("HQ", "Culture and Talent Specialist", "Viviana Niño", 400.00, "Pagado", "Zelle", "30 de cada mes"),
        ("HQ", "Personal Fijo", "Paulina Gil", 166.67, "Pagado", "Zelle", "30 de cada mes"),
        ("HQ", "Personal Fijo", "Adriana Adrian", 1800.00, "Pagado", "Zelle", "30 de cada mes"),
        ("USA", "Personal Fijo + comisión", "Max Wejc", 400.00, "Pagado", "Zelle", "15 de cada mes"),
    ],
    8: [
        ("Latam", "Teacher Assistant", "Marta Fagundez", 1350.00, "Pagado", "Transferwise", "30 de cada mes"),
        ("Latam", "Instructor", "Diego Bullor", 2186.10, "Pagado", "ACH", "30 de cada mes"),
        ("HQ", "Staff", "Ariana Sánchez", 4652.00, "Pagado", "ACH", "8 de cada mes"),
        ("Latam", "Marketing", "Génesis CM", 1075.00, IBERO, "Cash", "30 de cada mes, Iberoamérica paga"),
        ("HQ", "Staff", "Kevin - Contabilidad", 600.00, "Pagado", "ACH", "10 de cada mes"),
        ("Latam", "Marketing", "Yerden", 1110.00, IBERO, "Cash", "Iberoamérica paga"),
        ("Latam", "Staff", "Paula Fernandez", 2185.00, IBERO, "Zelle", "Iberoamérica paga"),
        ("Latam", "Staff", "Valentina Ancieta", 3030.00, "Pagado", "ACH - BoFa", "8 de cada mes"),
        ("HQ", "Staff", "Lorena Gubaira", 620.00, "Pagado", "Melio", "03 de cada mes"),
        ("HQ", "Brand Content Lead", "Anik Meijer-Werner", 1350.00, "Pagado", "ACH", "30 de cada mes"),
        ("HQ", "Office Assistant", "Andreina Daher", 625.00, IBERO, "Zelle", "Iberoamérica paga"),
        ("HQ", "Developer", "Luis Miguel", 1800.00, "Pagado", "Transferwise", "03 de cada mes"),
        ("HQ", "Career Support HQ", "Daniela Maestre", 1235.00, IBERO, "ACH", "Iberoamérica paga"),
        ("USA", "Admissions", "Eliezer Pilowsky (Eli)", 4946.96, "Pagado", "ACH", "03 de cada mes"),
        ("HQ", "Junior Growth Engineer", "Alejandro Mauricio Jimenez Morales", 500.00, "Pagado", "ACH", "30 de cada mes"),
        ("HQ", "Community Specialist", "Carlos Avila", 650.00, "Pagado", "ACH - BoFa", "30 de cada mes"),
        ("HQ", "Career Support para Campus", "Fabiana Pereira", 950.00, "Pagado", "ACH", "30 de cada mes"),
        ("USA", "Program Manager USA", "Loreto Concha", 1600.00, "Pagado", "ACH", "30 de cada mes"),
        ("HQ", "Culture and Talent Specialist", "Viviana Niño", 440.00, "Pagado", "Zelle", "30 de cada mes"),
        ("HQ", "Paid Media Lead", "Paulina Gil", 200.00, "Pagado", "Zelle", "30 de cada mes"),
        ("HQ", "Paid Media Lead for Iberoamérica", "Adriana Adrian", 3000.00, "Pagado", "Zelle", "30 de cada mes"),
    ],
    9: [
        ("Latam", "Teacher Assistant", "Marta Fagundez", 1350.00, "Pagado", "Transferwise", "30 de cada mes"),
        ("Latam", "Instructor", "Diego Bullor", 2461.34, "Pagado", "ACH", "30 de cada mes"),
        ("HQ", "Staff", "Ariana Sánchez", 2242.40, "Pagado", "ACH", "8 de cada mes"),
        ("Latam", "Marketing", "Génesis CM", 1057.00, IBERO, "Cash", "30 de cada mes, Iberoamérica paga"),
        ("HQ", "Staff", "Kevin - Contabilidad", 600.00, "Pagado", "ACH", "10 de cada mes"),
        ("Latam", "Marketing", "Yerden", 1110.00, IBERO, "Cash", "Iberoamérica paga"),
        ("Latam", "Staff", "Paula Fernandez", 2865.00, IBERO, "Zelle", "Iberoamérica paga"),
        ("Latam", "Staff", "Valentina Ancieta", 3645.00, "Pagado", "ACH - BoFa", "8 de cada mes"),
        ("HQ", "Staff", "Lorena Gubaira", 620.00, "Pagado", "Melio", "03 de cada mes"),
        ("HQ", "Brand Content Lead", "Anik Meijer-Werner", 1350.00, "Pagado", "ACH", "30 de cada mes"),
        ("HQ", "Office Assistant", "Andreina Daher", 785.00, IBERO, "Zelle", "Iberoamérica paga"),
        ("Latam", "Admission Latam", "Marcia Elias de Ancieta", 724.00, IBERO, "Zelle", "Iberoamérica paga"),
        ("HQ", "Developer", "Luis Miguel", 1800.00, "Pagado", "Transferwise", "03 de cada mes"),
        ("HQ", "Career Support HQ", "Daniela Maestre", 1340.00, IBERO, "ACH", "Iberoamérica paga — egreso, hasta el 30 de septiembre 2026"),
        ("HQ", "Junior Growth Engineer", "Alejandro Mauricio Jimenez Morales", 500.00, "Pagado", "ACH", "30 de cada mes"),
        ("HQ", "Community Specialist", "Carlos Avila", 650.00, "Pagado", "ACH - BoFa", "30 de cada mes"),
        ("HQ", "Career Support para Campus", "Fabiana Pereira", 920.00, "Pagado", "ACH", "30 de cada mes"),
        ("USA", "Program Manager USA", "Loreto Concha", 1600.00, "Pagado", "ACH", "30 de cada mes"),
        ("HQ", "Culture and Talent Specialist", "Viviana Niño", 480.00, "Pagado", "Zelle", "30 de cada mes"),
        ("HQ", "Paid Media Lead", "Paulina Gil", 166.67, "Pagado", "Zelle", "30 de cada mes"),
        ("HQ", "Paid Media Lead for Iberoamérica", "Adriana Adrian", 1520.00, "Pagado", "Zelle", "30 de cada mes"),
        ("USA", "Admissions Assistant", "Natasha Ramirez", 120.00, "Pagado", "Zelle", "30 de cada mes"),
    ],
}

# (month, section, name, department, method, amount) -- from the bank statements
BANK_LINES = [
    (8, 'debt', 'Alejandro SoFi loans', 'Financing', 'ACH / Zelle', 4065.0),
    (9, 'debt', 'Alejandro SoFi loans', 'Financing', 'ACH / Zelle', 4064.0),
    (6, 'debt', 'AspireFunding', 'Financing', 'ACH / Zelle', 1747.81),
    (6, 'debt', 'AspireFunding payoff via Ninja I Myrtle — one-off', 'Financing', 'ACH / Zelle', 26063.46),
    (6, 'debt', 'Credit card payments', 'Credit cards', 'Online payment', 4885.27),
    (7, 'debt', 'Credit card payments', 'Credit cards', 'Online payment', 4932.3),
    (6, 'debt', 'Forward Financing', 'Financing', 'ACH / Zelle', 8509.0),
    (7, 'debt', 'Forward Financing', 'Financing', 'ACH / Zelle', 10636.25),
    (8, 'debt', 'Forward Financing', 'Financing', 'ACH / Zelle', 4254.5),
    (8, 'debt', 'Forward Financing payoff — one-off', 'Financing', 'ACH / Zelle', 47014.0),
    (8, 'debt', 'Libertas', 'Financing', 'ACH / Zelle', 9183.68),
    (9, 'debt', 'Libertas', 'Financing', 'ACH / Zelle', 11479.6),
    (6, 'debt', 'Papa loan', 'Financing', 'ACH / Zelle', 700.0),
    (7, 'debt', 'Papa loan', 'Financing', 'ACH / Zelle', 1050.0),
    (9, 'debt', 'Papa loan', 'Financing', 'ACH / Zelle', 575.0),
    (7, 'debt', 'Personal loan (Marcelo)', 'Financing', 'ACH / Zelle', 1500.0),
    (9, 'debt', 'Personal loan (Marcelo)', 'Financing', 'ACH / Zelle', 2000.0),
    (6, 'debt', 'Tigre', 'Financing', 'ACH / Zelle', 12679.0),
    (7, 'debt', 'Tigre', 'Financing', 'ACH / Zelle', 4429.0),
    (8, 'debt', 'Tigre', 'Financing', 'ACH / Zelle', 6680.0),
    (9, 'debt', 'Tigre', 'Financing', 'ACH / Zelle', 6679.0),
    (7, 'debt', 'de Jongh', 'Financing', 'ACH / Zelle', 2500.0),
    (8, 'debt', 'de Jongh', 'Financing', 'ACH / Zelle', 3000.0),
    (9, 'debt', 'de Jongh', 'Financing', 'ACH / Zelle', 3000.0),
    (6, 'founders', 'Alejandro Sánchez', 'Founder', 'Check', 14146.0),
    (7, 'founders', 'Alejandro Sánchez', 'Founder', 'Check', 13066.0),
    (8, 'founders', 'Alejandro Sánchez', 'Founder', 'Check', 9026.0),
    (9, 'founders', 'Alejandro Sánchez', 'Founder', 'Check', 9026.0),
    (6, 'founders', 'Marcelo Ricigliano', 'Founder', 'Zelle', 9850.0),
    (7, 'founders', 'Marcelo Ricigliano', 'Founder', 'Zelle', 12650.0),
    (8, 'founders', 'Marcelo Ricigliano', 'Founder', 'Zelle', 10745.0),
    (9, 'founders', 'Marcelo Ricigliano', 'Founder', 'Zelle', 9077.0),
    (6, 'instructors_ref', 'Instructors paid (bank statements)', 'Instructors', 'Mixed', 13994.3),
    (7, 'instructors_ref', 'Instructors paid (bank statements)', 'Instructors', 'Mixed', 14546.2),
    (8, 'instructors_ref', 'Instructors paid (bank statements)', 'Instructors', 'Mixed', 15700.05),
    (9, 'instructors_ref', 'Instructors paid (bank statements)', 'Instructors', 'Mixed', 14981.0),
    (6, 'marketing', 'Ads reimbursed to Marcelo (Meta/TikTok)', 'Paid media (all markets, USA card)', 'Card', 2760.0),
    (6, 'marketing', 'Google Ads', 'Paid media (all markets, USA card)', 'Card', 17877.94),
    (7, 'marketing', 'Google Ads', 'Paid media (all markets, USA card)', 'Card', 21232.91),
    (8, 'marketing', 'Google Ads', 'Paid media (all markets, USA card)', 'Card', 17901.59),
    (9, 'marketing', 'Google Ads', 'Paid media (all markets, USA card)', 'Card', 25044.92),
    (6, 'marketing', 'Meta / Facebook Ads', 'Paid media (all markets, USA card)', 'Card', 4472.63),
    (7, 'marketing', 'Meta / Facebook Ads', 'Paid media (all markets, USA card)', 'Card', 7779.31),
    (8, 'marketing', 'Meta / Facebook Ads', 'Paid media (all markets, USA card)', 'Card', 7282.98),
    (9, 'marketing', 'Meta / Facebook Ads', 'Paid media (all markets, USA card)', 'Card', 4804.57),
    (6, 'marketing', 'Microsoft Ads', 'Paid media (all markets, USA card)', 'Card', 254.19),
    (7, 'marketing', 'Microsoft Ads', 'Paid media (all markets, USA card)', 'Card', 215.11),
    (8, 'marketing', 'Microsoft Ads', 'Paid media (all markets, USA card)', 'Card', 204.56),
    (9, 'marketing', 'Microsoft Ads', 'Paid media (all markets, USA card)', 'Card', 257.26),
    (6, 'marketing', 'Other marketing', 'Paid media (all markets, USA card)', 'Card', 178.99),
    (6, 'operations', 'AT&T', 'Phone', 'Card', 80.25),
    (7, 'operations', 'AT&T', 'Phone', 'Card', 80.25),
    (8, 'operations', 'AT&T', 'Phone', 'Card', 81.0),
    (9, 'operations', 'AT&T', 'Phone', 'Card', 81.0),
    (6, 'operations', 'Bank & processing fees', 'Fees', 'Auto', 3520.34),
    (7, 'operations', 'Bank & processing fees', 'Fees', 'Auto', 2644.09),
    (8, 'operations', 'Bank & processing fees', 'Fees', 'Auto', 952.81),
    (9, 'operations', 'Bank & processing fees', 'Fees', 'Auto', 1912.23),
    (6, 'operations', 'Bill.com / Documenso', 'Accounting', 'ACH debit', 279.86),
    (7, 'operations', 'Bill.com / Documenso', 'Accounting', 'ACH debit', 275.0),
    (8, 'operations', 'Bill.com / Documenso', 'Accounting', 'ACH debit', 282.8),
    (9, 'operations', 'Bill.com / Documenso', 'Accounting', 'ACH debit', 245.0),
    (6, 'operations', 'Coworking (Nest / Industrious)', 'Office', 'Zelle', 1350.0),
    (8, 'operations', 'Coworking (Nest / Industrious)', 'Office', 'Zelle', 750.0),
    (6, 'operations', 'Freedom Voice', 'Phone', 'Card', 10.56),
    (7, 'operations', 'Freedom Voice', 'Phone', 'Card', 10.56),
    (8, 'operations', 'Freedom Voice', 'Phone', 'Card', 10.56),
    (9, 'operations', 'Freedom Voice', 'Phone', 'Card', 10.56),
    (6, 'operations', 'HOA Books (bookkeeping)', 'Accounting', 'ACH debit', 5194.0),
    (7, 'operations', 'HOA Books (bookkeeping)', 'Accounting', 'ACH debit', 2899.0),
    (8, 'operations', 'HOA Books (bookkeeping)', 'Accounting', 'ACH debit', 2899.0),
    (9, 'operations', 'HOA Books (bookkeeping)', 'Accounting', 'ACH debit', 2899.0),
    (6, 'operations', 'Industrious (coworking)', 'Office', 'Card', 443.0),
    (7, 'operations', 'Industrious (coworking)', 'Office', 'Card', 443.0),
    (9, 'operations', 'Industrious (coworking)', 'Office', 'Card', 115.0),
    (6, 'operations', 'T-Mobile', 'Phone', 'Card', 529.63),
    (7, 'operations', 'T-Mobile', 'Phone', 'Card', 518.61),
    (8, 'operations', 'T-Mobile', 'Phone', 'Card', 518.67),
    (9, 'operations', 'T-Mobile', 'Phone', 'Card', 530.76),
    (6, 'payroll_w2', 'Payroll W-2 — net pay (Intuit)', 'Payroll', 'ACH debit', 13266.46),
    (7, 'payroll_w2', 'Payroll W-2 — net pay (Intuit)', 'Payroll', 'ACH debit', 13266.46),
    (8, 'payroll_w2', 'Payroll W-2 — net pay (Intuit)', 'Payroll', 'ACH debit', 13266.47),
    (9, 'payroll_w2', 'Payroll W-2 — net pay (Intuit)', 'Payroll', 'ACH debit', 13266.47),
    (6, 'payroll_w2', 'Payroll taxes (Intuit)', 'Payroll', 'ACH debit', 3329.59),
    (7, 'payroll_w2', 'Payroll taxes (Intuit)', 'Payroll', 'ACH debit', 3329.59),
    (8, 'payroll_w2', 'Payroll taxes (Intuit)', 'Payroll', 'ACH debit', 3329.57),
    (9, 'payroll_w2', 'Payroll taxes (Intuit)', 'Payroll', 'ACH debit', 3329.57),
    (7, 'people', "D'Este (CHK 1059)", 'Spain', 'Online transfer', 620.0),
    (8, 'people', "D'Este (CHK 1059)", 'Spain', 'Online transfer', 620.0),
    (9, 'people', "D'Este (CHK 1059)", 'Spain', 'Online transfer', 620.0),
    (6, 'people', 'Eliezer Pilowsky (Eli)', 'Admissions', 'ACH / Zelle', 6790.0),
    (7, 'people', 'Eliezer Pilowsky (Eli)', 'Admissions', 'ACH / Zelle', 9500.0),
    (9, 'people', 'Eliezer Pilowsky (Eli)', 'Admissions', 'ACH / Zelle', 3421.62),
    (6, 'people', 'Other contractors paid (bank, to classify)', 'Unclassified', 'Mixed', 7166.5),
    (7, 'people', 'Other contractors paid (bank, to classify)', 'Unclassified', 'Mixed', 7254.11),
    (8, 'people', 'Other contractors paid (bank, to classify)', 'Unclassified', 'Mixed', 2422.99),
    (6, 'reimbursement', '4Geeks España settlement (reimburses marketing & team)', 'Spain', 'Wire', -12159.36),
    (7, 'reimbursement', '4Geeks España settlement (reimburses marketing & team)', 'Spain', 'Wire', -9323.43),
    (8, 'reimbursement', '4Geeks España settlement (reimburses marketing & team)', 'Spain', 'Wire', -18758.19),
    (9, 'reimbursement', '4Geeks España settlement (reimburses marketing & team)', 'Spain', 'Wire', -5371.77),
    (8, 'taxes', 'IRS payment', 'IRS', 'ACH debit', 2000.0),
    (6, 'tech', 'AWS', 'Hosting', 'Card', 38.34),
    (6, 'tech', 'Adobe', 'Design', 'Card', 39.98),
    (8, 'tech', 'Adobe', 'Design', 'Card', 19.99),
    (9, 'tech', 'Adobe', 'Design', 'Card', 19.99),
    (6, 'tech', 'Anthropic', 'AI APIs', 'Card', 189.06),
    (8, 'tech', 'Anthropic', 'AI APIs', 'Card', 10.73),
    (9, 'tech', 'Anthropic', 'AI APIs', 'Card', 32.83),
    (6, 'tech', 'Brevo', 'Email', 'Card', 147.0),
    (7, 'tech', 'Brevo', 'Email', 'Card', 147.0),
    (8, 'tech', 'Brevo', 'Email', 'Card', 147.0),
    (9, 'tech', 'Brevo', 'Email', 'Card', 147.0),
    (6, 'tech', 'Buzzsprout', 'Podcast', 'Card', 12.0),
    (7, 'tech', 'Buzzsprout', 'Podcast', 'Card', 12.0),
    (8, 'tech', 'Buzzsprout', 'Podcast', 'Card', 12.0),
    (9, 'tech', 'Buzzsprout', 'Podcast', 'Card', 12.0),
    (6, 'tech', 'Cromojo URL monitor', 'Dev tools', 'Card', 10.0),
    (7, 'tech', 'Cromojo URL monitor', 'Dev tools', 'Card', 10.0),
    (8, 'tech', 'Cromojo URL monitor', 'Dev tools', 'Card', 10.0),
    (9, 'tech', 'Cromojo URL monitor', 'Dev tools', 'Card', 10.0),
    (6, 'tech', 'DigitalOcean', 'Hosting', 'Card', 96.89),
    (6, 'tech', 'Google (other)', 'Workspace', 'Card', 19.99),
    (8, 'tech', 'Google (other)', 'Workspace', 'Card', 19.99),
    (6, 'tech', 'Google Cloud', 'Hosting', 'Card', 200.0),
    (7, 'tech', 'Google Cloud', 'Hosting', 'Card', 195.96),
    (8, 'tech', 'Google Cloud', 'Hosting', 'Card', 185.46),
    (9, 'tech', 'Google Cloud', 'Hosting', 'Card', 289.86),
    (7, 'tech', 'Google One', 'Workspace', 'Card', 19.99),
    (9, 'tech', 'Google One', 'Workspace', 'Card', 19.99),
    (9, 'tech', 'Grok (xAI)', 'AI APIs', 'Card', 160.0),
    (6, 'tech', 'Heroku', 'Hosting', 'Card', 1306.44),
    (7, 'tech', 'Heroku', 'Hosting', 'Card', 1308.14),
    (8, 'tech', 'Heroku', 'Hosting', 'Card', 1314.15),
    (9, 'tech', 'Heroku', 'Hosting', 'Card', 1296.31),
    (6, 'tech', 'HeyGen', 'Video', 'Card', 29.0),
    (7, 'tech', 'HeyGen', 'Video', 'Card', 29.0),
    (8, 'tech', 'HeyGen', 'Video', 'Card', 29.0),
    (9, 'tech', 'HeyGen', 'Video', 'Card', 29.0),
    (6, 'tech', 'JustCall', 'Dialer', 'Reimbursed to Marcelo', 754.0),
    (7, 'tech', 'JustCall', 'Dialer', 'Reimbursed to Marcelo', 600.0),
    (8, 'tech', 'JustCall', 'Dialer', 'Reimbursed to Marcelo', 425.0),
    (9, 'tech', 'JustCall', 'Dialer', 'Reimbursed to Marcelo', 155.0),
    (8, 'tech', 'Kite', 'Software', 'Card', 59.0),
    (9, 'tech', 'Kite', 'Software', 'Card', 59.0),
    (6, 'tech', 'LinkedIn', 'Sales tools', 'Card', 167.99),
    (7, 'tech', 'LinkedIn', 'Sales tools', 'Card', 179.99),
    (8, 'tech', 'LinkedIn', 'Sales tools', 'Card', 281.99),
    (9, 'tech', 'LinkedIn', 'Sales tools', 'Card', 289.99),
    (6, 'tech', 'Mailgun', 'Email', 'Card', 24.69),
    (7, 'tech', 'Mailgun', 'Email', 'Card', 20.37),
    (8, 'tech', 'Mailgun', 'Email', 'Card', 18.65),
    (9, 'tech', 'Mailgun', 'Email', 'Card', 17.18),
    (9, 'tech', 'Namecheap', 'Domains', 'Card', 29.66),
    (6, 'tech', 'Nexa', 'Software', 'Card', 150.0),
    (7, 'tech', 'Nexa', 'Software', 'Card', 150.0),
    (8, 'tech', 'Nexa', 'Software', 'Card', 150.0),
    (9, 'tech', 'Nexa', 'Software', 'Card', 150.0),
    (6, 'tech', 'Notion', 'Workspace', 'Card', 600.0),
    (7, 'tech', 'Notion', 'Workspace', 'Card', 588.0),
    (8, 'tech', 'Notion', 'Workspace', 'Card', 600.78),
    (9, 'tech', 'Notion', 'Workspace', 'Card', 654.21),
    (6, 'tech', 'Notion', 'Workspace', 'Reimbursed to Marcelo', 670.0),
    (7, 'tech', 'Notion', 'Workspace', 'Reimbursed to Marcelo', 1412.0),
    (9, 'tech', 'Notion', 'Workspace', 'Reimbursed to Marcelo', 450.0),
    (6, 'tech', 'OpenRouter', 'AI APIs', 'Card', 553.98),
    (7, 'tech', 'OpenRouter', 'AI APIs', 'Card', 26.38),
    (8, 'tech', 'OpenRouter', 'AI APIs', 'Card', 26.38),
    (9, 'tech', 'OpenRouter', 'AI APIs', 'Card', 52.76),
    (9, 'tech', 'OpenRush', 'Software', 'Card', 20.0),
    (6, 'tech', 'PromptWatch', 'SEO/AI', 'Card', 89.0),
    (7, 'tech', 'PromptWatch', 'SEO/AI', 'Card', 89.0),
    (8, 'tech', 'PromptWatch', 'SEO/AI', 'Card', 89.0),
    (9, 'tech', 'PromptWatch', 'SEO/AI', 'Card', 89.0),
    (6, 'tech', 'Refresh Miami', 'Community', 'Card', 10.0),
    (7, 'tech', 'Refresh Miami', 'Community', 'Card', 10.0),
    (8, 'tech', 'Refresh Miami', 'Community', 'Card', 10.0),
    (9, 'tech', 'Refresh Miami', 'Community', 'Card', 10.0),
    (6, 'tech', 'Replit', 'Dev tools', 'Card', 988.31),
    (7, 'tech', 'Replit', 'Dev tools', 'Card', 566.72),
    (8, 'tech', 'Replit', 'Dev tools', 'Card', 216.28),
    (9, 'tech', 'Replit', 'Dev tools', 'Card', 100.0),
    (7, 'tech', 'Ringover', 'Dialer', 'Reimbursed to Marcelo', 685.0),
    (9, 'tech', 'Ringover', 'Dialer', 'Reimbursed to Marcelo', 658.0),
    (6, 'tech', 'Riverside', 'Video', 'Card', 19.0),
    (7, 'tech', 'Riverside', 'Video', 'Card', 38.0),
    (8, 'tech', 'Riverside', 'Video', 'Card', 19.0),
    (6, 'tech', 'ScreenshotMachine', 'Dev tools', 'Card', 10.33),
    (7, 'tech', 'ScreenshotMachine', 'Dev tools', 'Card', 179.34),
    (8, 'tech', 'ScreenshotMachine', 'Dev tools', 'Card', 469.65),
    (9, 'tech', 'ScreenshotMachine', 'Dev tools', 'Card', 10.33),
    (8, 'tech', 'Semrush', 'SEO', 'Reimbursed to Marcelo', 110.0),
    (6, 'tech', 'Stape', 'Tracking', 'Card', 40.0),
    (7, 'tech', 'Stape', 'Tracking', 'Card', 20.0),
    (6, 'tech', 'StreamYard', 'Video', 'Card', 44.99),
    (7, 'tech', 'StreamYard', 'Video', 'Card', 44.99),
    (8, 'tech', 'StreamYard', 'Video', 'Card', 44.99),
    (9, 'tech', 'StreamYard', 'Video', 'Card', 44.99),
    (6, 'tech', 'Vercel', 'Hosting', 'Card', 66.81),
    (7, 'tech', 'Vercel', 'Hosting', 'Card', 64.5),
    (8, 'tech', 'Vercel', 'Hosting', 'Card', 60.67),
    (9, 'tech', 'Vercel', 'Hosting', 'Card', 61.01),
    (6, 'tech', 'Zapier', 'Automation', 'Card', 3.1),
]


# October 2026 budget lines (section, division, department, name, amount, status, method, frequency, paid_by, notes)
OCTOBER_EXTRA = [
    ("people", "USA", "Admissions", "Eliezer Pilowsky (Eli)", 6600, "Pendiente", "ACH", "03 de cada mes", "4Geeks USA", "Jun–Sep average"),
    ("marketing", "USA", "Paid media", "Marketing USA (Google, Meta, Microsoft)", 15000, "Pendiente", "Card", "Monthly", "4Geeks USA", "Agreed Oct 2026"),
    ("marketing", "Latam", "Paid media", "Marketing LATAM", 5000, "Pendiente", "Card", "Paid by LATAM at month end", "LATAM", "Agreed Oct 2026"),
    ("marketing", "Spain", "Paid media", "Marketing Spain", 30000, "España paga", "Card", "Paid by Spain at month end", "España", "Agreed Oct 2026"),
    ("payroll_w2", "USA", "Payroll", "Payroll W-2 — gross before taxes (Intuit)", 12500, "Pendiente", "ACH debit", "Monthly", "4Geeks USA", None),
    ("payroll_w2", "USA", "Payroll", "Payroll taxes (Intuit)", 3300, "Pendiente", "ACH debit", "Monthly", "4Geeks USA", None),
    ("founders", "USA", "Founder", "Marcelo Ricigliano", 9000, "Pendiente", "Zelle", "Monthly", "4Geeks USA", None),
    ("founders", "USA", "Founder", "Alejandro Sánchez", 9000, "Pendiente", "Check", "Monthly", "4Geeks USA", None),
    ("debt", "USA", "Financing", "Libertas — July 2026 advance ($2,296/wk)", 9949, "Pendiente", "ACH debit", "Weekly", "4Geeks USA", "$2,296 × 52 ÷ 12"),
    ("debt", "USA", "Financing", "Libertas — Oct 2026 $75k advance ($1,722/wk)", 1722, "Pendiente", "ACH debit", "Weekly", "4Geeks USA", "First debit 7 days after funding; $7,462/month from November"),
    ("debt", "USA", "Financing", "Tigre", 6679, "Pendiente", "Zelle", "1 de cada mes", "4Geeks USA", "Oct: $4,000 paid Oct 6 + $2,679 pending. Last payment Jan 1"),
    ("debt", "USA", "Family loan", "de Jongh family loan ($750/wk)", 3250, "Pendiente", "Zelle", "Weekly", "4Geeks USA", None),
    ("debt", "USA", "Family loan", "Papa loan ($350/wk)", 1517, "Pendiente", "Zelle", "Weekly", "4Geeks USA", None),
    ("debt", "USA", "Founder loan", "Alejandro SoFi loans", 5000, "Pendiente", "Zelle", "Monthly", "4Geeks USA", "6 months left (to March)"),
    ("debt", "USA", "Founder loan", "Marcelo personal loan ($2k/wk)", 8667, "Pendiente", "Zelle", "Weekly", "4Geeks USA", "Ends mid-December"),
    ("debt", "USA", "Credit cards", "Credit cards (minimum)", 3000, "Pendiente", "Online payment", "Monthly", "4Geeks USA", "~$25k balance"),
    ("taxes", "USA", "IRS", "IRS payment plan", 2000, "Pendiente", "ACH debit", "Monthly", "4Geeks USA", "Approved $2k/month"),
    ("reimbursement", "Spain", "Spain", "Spain/LATAM reimbursement for shared team", -6000, "Pendiente", "Wire", "Monthly", "4Geeks USA", "Per Marcelo: ~$6k of contractors is paid back by Spain/LATAM"),
]
# Sections whose September bank lines are carried into October as estimates
CARRY_FROM_SEPT = ("tech", "operations")
OCT_LEFT = {"Daniela Maestre"}


def _period(db, m):
    label, start, end = MONTHS[m]
    p = db.query(PayPeriod).filter(PayPeriod.start_date == start).first()
    if not p:
        p = PayPeriod(label=label, start_date=start, end_date=end)
        db.add(p)
        db.flush()
    return p


def _entry(period_id, **kw):
    kw.setdefault("paid_by", "4Geeks USA")
    kw["amount"] = Decimal(str(kw["amount"]))
    return CostEntry(period_id=period_id, **kw)


def _sheet_entry(pid, row, source="payroll sheet", projection=False, status=None):
    div, dept, name, amt, st, method, freq = row
    paid_by = "Iberoamérica" if st == IBERO else "4Geeks USA"
    return _entry(pid, section="people", division=div, department=dept, name=name, amount=amt,
                  status=status or st, method=method, frequency=freq,
                  paid_by=paid_by, source=source, is_projection=projection)


def seed_costs(db) -> int:
    created = 0
    periods = {m: _period(db, m) for m in MONTHS}

    # History: Jun-Sep
    for m in (6, 7, 8, 9):
        pid = periods[m].id
        if db.query(CostEntry.id).filter(CostEntry.period_id == pid).first():
            continue
        for row in SHEETS[m]:
            db.add(_sheet_entry(pid, row)); created += 1
        for (mo, section, name, dept, method, amount) in BANK_LINES:
            if mo != m:
                continue
            notes = None
            paid_by = "4Geeks USA"
            status = "Pagado"
            division = "USA"
            if section == "instructors_ref":
                notes = ("Bank total paid to instructors this month. Used only while the Instructors "
                         "section has no rows for this month.")
            if section == "marketing":
                division = "All"
                notes = "Charged on the USA card for all markets; Spain/LATAM reimburse part (see Reimbursements)."
            if name.startswith("D'Este"):
                division, paid_by, status = "Spain", "España", "España paga"
                notes = "Paid by Spain (per Marcelo). Confirm the account."
            if section == "reimbursement":
                division = "Spain"
                status = "Recibido"
            db.add(_entry(pid, section=section, division=division, department=dept, name=name,
                          amount=amount, status=status, method=method, frequency=None, paid_by=paid_by,
                          source="bank statement", notes=notes))
            created += 1

    # October: projection
    oct_pid = periods[10].id
    if not db.query(CostEntry.id).filter(CostEntry.period_id == oct_pid).first():
        for row in SHEETS[9]:
            if row[2] in OCT_LEFT:
                continue
            st = IBERO if row[4] == IBERO else "Pendiente"
            db.add(_sheet_entry(oct_pid, row, source="projection", projection=True, status=st)); created += 1
        for (section, div, dept, name, amount, status, method, freq, paid_by, notes) in OCTOBER_EXTRA:
            db.add(_entry(oct_pid, section=section, division=div, department=dept, name=name, amount=amount,
                          status=status, method=method, frequency=freq, paid_by=paid_by, notes=notes,
                          source="budget", is_projection=True)); created += 1
        for (mo, section, name, dept, method, amount) in BANK_LINES:
            if mo == 9 and section in CARRY_FROM_SEPT:
                db.add(_entry(oct_pid, section=section, division="USA", department=dept, name=name,
                              amount=amount, status="Pendiente", method=method, source="projection",
                              is_projection=True, notes="Estimate = September actual")); created += 1
            if mo == 9 and section == "instructors_ref":
                db.add(_entry(oct_pid, section=section, division="USA", department=dept,
                              name="Instructors (estimate = September bank total)", amount=amount,
                              status="Pendiente", method=method, source="projection", is_projection=True,
                              notes="Replaced automatically by the Instructors section once October rows exist.")); created += 1
        db.flush()

    # November: copy of October
    nov_pid = periods[11].id
    if not db.query(CostEntry.id).filter(CostEntry.period_id == nov_pid).first():
        for e in db.query(CostEntry).filter(CostEntry.period_id == oct_pid).all():
            amount = e.amount
            notes = e.notes
            if e.name.startswith("Libertas — Oct 2026"):
                amount, notes = Decimal("7462"), "$1,722 × 52 ÷ 12"
            db.add(CostEntry(
                period_id=nov_pid, section=e.section, division=e.division, department=e.department,
                name=e.name, amount=amount, status=e.status if e.status in (IBERO, "España paga") else "Pendiente",
                method=e.method, frequency=e.frequency, paid_by=e.paid_by, priority=e.priority, notes=notes,
                source="projection", is_projection=True,
            )); created += 1
    db.flush()
    return created


# Loans register (as of Oct 20, 2026). Balances are estimates from the bank
# statements + the contracts -- edit them in the Loans segment.
LOANS = [
    dict(name="Libertas — July 2026 advance", lender="Libertas Funding", kind="MCA / revenue-based", frequency="weekly",
         payment=2296, payment_day="Weekly ACH", start_date=date(2026, 8, 7), end_date=date(2027, 8, 27),
         original_amount=97000, total_payback=129980, balance_remaining=102429, balance_as_of=date(2026, 10, 20),
         notes="$97k × 1.34. ~12 debits made by Oct 16 (estimate) → ~44 weeks left. Confirm payoff letter."),
    dict(name="Libertas — Oct 2026 $75k advance", lender="Libertas Funding", kind="MCA / revenue-based", frequency="weekly",
         payment=1722, payment_day="Weekly ACH", start_date=date(2026, 10, 26), end_date=date(2027, 12, 6),
         original_amount=75000, total_payback=101250, balance_remaining=101250, balance_as_of=date(2026, 10, 20),
         notes="Contract Oct 19: $73.5k net after $1.5k fee, factor 1.35, est. 14 months. Early payoff 1.22–1.32 (months 1–6)."),
    dict(name="Tigre", lender="Tigre", kind="Private", frequency="monthly", payment=6679, payment_day="1",
         start_date=date(2026, 11, 1), end_date=date(2027, 1, 1), original_amount=50000, total_payback=53434,
         balance_remaining=22717, balance_as_of=date(2026, 10, 20),
         notes="$2,679 still owed for Oct 1 (pay now) + Nov 1, Dec 1, Jan 1. Declined a payoff discount."),
    dict(name="de Jongh family loan", lender="Ingrid & Carlos de Jongh", kind="Family", frequency="weekly", payment=750,
         payment_day="Weekly Zelle", start_date=date(2026, 10, 16), end_date=date(2028, 10, 13), original_amount=150000,
         notes="Tiered weekly payments ($500 → $750 → $1,000). ~2 years left. Candidate to pause in tight months."),
    dict(name="Papa loan", lender="Family", kind="Family", frequency="weekly", payment=350, payment_day="Weekly Zelle",
         start_date=date(2026, 10, 14), end_date=date(2028, 10, 11), notes="~2 years left. Candidate to pause in tight months."),
    dict(name="Marcelo personal loan", lender="Marcelo Ricigliano", kind="Founder", frequency="weekly", payment=2000,
         payment_day="Weekly Zelle", start_date=date(2026, 10, 12), end_date=date(2026, 12, 14),
         notes="10 weekly payments left as of Oct 12 (repays the $25k)."),
    dict(name="Alejandro SoFi loans", lender="SoFi (via Alejandro)", kind="Founder", frequency="monthly", payment=5000,
         payment_day="10", start_date=date(2026, 10, 10), end_date=date(2027, 3, 10),
         notes="Two SoFi loans (~$1,860 + $2,205 in statements); budgeted at $5k/month, 6 months left."),
    dict(name="IRS payment plan", lender="IRS", kind="Tax plan", frequency="monthly", payment=2000, payment_day="28",
         start_date=date(2026, 10, 28), notes="Approved at $2k/month."),
    dict(name="Credit cards (minimum)", lender="Credit cards", kind="Credit card", frequency="monthly", payment=3000,
         payment_day="25", start_date=date(2026, 10, 25), balance_remaining=25000, balance_as_of=date(2026, 10, 20),
         notes="~$25k total balance; $3k is the minimum."),
]


def seed_loans(db) -> int:
    from app.models.models import Loan
    if db.query(Loan.id).first():
        return 0
    for row in LOANS:
        db.add(Loan(**row))
    db.flush()
    return len(LOANS)
