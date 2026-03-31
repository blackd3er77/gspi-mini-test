import json
import random
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

OUT = Path(__file__).with_name('questions.json')
random.seed(42)


def fmt_num(n):
    d = Decimal(str(n)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    s = format(d, 'f')
    if '.' in s:
        s = s.rstrip('0').rstrip('.')
    return s


def make_question_bank(n_each=25):
    questions = []
    qid = 1

    # 1. Salt concentration
    for _ in range(n_each):
        w1 = random.choice([10, 15, 20, 25, 30, 40, 50])
        w2 = random.choice([10, 15, 20, 25, 30, 40, 50])
        p1 = random.choice([2.0, 2.4, 2.5, 3.0, 3.2, 3.5, 3.6, 4.0, 4.5, 5.0])
        p2 = random.choice([1.5, 2.0, 2.4, 2.8, 3.0, 3.5, 4.0, 4.2, 4.5, 5.0])
        salt = w1 * p1 / 100 + w2 * p2 / 100
        ans = salt / (w1 + w2) * 100
        questions.append({
            'id': qid,
            'category': 'salt_concentration',
            'question': f'When {w1}g of salt water with a {p1:.1f}% concentration of salt is mixed with {w2}g of salt water with a {p2:.1f}% concentration of salt, what is the percentage of the concentration of salt in the resulting mixed solution?',
            'answer': fmt_num(ans),
            'unit': '%',
        })
        qid += 1

    # 2. Discount then tax (final price)
    for _ in range(n_each):
        price = random.choice([1200, 1500, 1800, 2000, 2400, 2500, 3000, 3600, 4200, 4800])
        disc = random.choice([5, 10, 15, 20, 25, 30])
        tax = random.choice([8, 10])
        ans = price * (100 - disc) / 100 * (100 + tax) / 100
        questions.append({
            'id': qid,
            'category': 'discount_tax',
            'question': f'An item costs {price} yen. After a discount of {disc}% and then sales tax of {tax}% is added, what is the final price in yen?',
            'answer': fmt_num(ans),
            'unit': 'yen',
        })
        qid += 1

    # 3. Work rate
    for _ in range(n_each):
        a = random.choice([4, 5, 6, 8, 10, 12])
        b = random.choice([5, 6, 8, 9, 10, 12, 15])
        ans = 1 / (1/a + 1/b)
        questions.append({
            'id': qid,
            'category': 'work_rate',
            'question': f'Worker A can finish a job in {a} days, and Worker B can finish the same job in {b} days. If they work together at the same constant pace, how many days will they need to finish the job?',
            'answer': fmt_num(ans),
            'unit': 'days',
        })
        qid += 1

    # 4. Distance / speed / time
    for _ in range(n_each):
        speed = random.choice([36, 40, 45, 48, 54, 60, 72])
        mins = random.choice([15, 20, 24, 25, 30, 36, 40, 45, 50])
        ans = speed * mins / 60
        questions.append({
            'id': qid,
            'category': 'speed_distance',
            'question': f'A car travels at a constant speed of {speed} km/h for {mins} minutes. How many kilometers does it travel?',
            'answer': fmt_num(ans),
            'unit': 'km',
        })
        qid += 1

    # 5. Average score
    for _ in range(n_each):
        count = random.choice([4, 5, 6])
        scores = [random.choice([58, 62, 64, 68, 70, 72, 75, 78, 80, 84, 88, 92]) for _ in range(count)]
        ans = sum(scores) / count
        score_text = ', '.join(map(str, scores))
        questions.append({
            'id': qid,
            'category': 'average',
            'question': f'The test scores of {count} students are {score_text}. What is the average score?',
            'answer': fmt_num(ans),
            'unit': 'points',
        })
        qid += 1

    # 6. Ratio split
    for _ in range(n_each):
        total = random.choice([72, 84, 90, 96, 108, 120, 132, 144])
        a = random.choice([2, 3, 4, 5, 6, 7])
        b = random.choice([3, 4, 5, 6, 7, 8, 9])
        while a == b:
            b = random.choice([3, 4, 5, 6, 7, 8, 9])
        ans = total * a / (a + b)
        questions.append({
            'id': qid,
            'category': 'ratio',
            'question': f'A quantity of {total} is divided between A and B in the ratio {a}:{b}. How much does A receive?',
            'answer': fmt_num(ans),
            'unit': '',
        })
        qid += 1

    return questions


def main():
    questions = make_question_bank(25)  # 150 questions total
    payload = {
        'meta': {
            'title': 'GSPI Mini Test Bank',
            'question_count': len(questions),
            'description': 'Auto-generated sample numeric question bank for the GSPI-style mini web app.'
        },
        'questions': questions,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Wrote {len(questions)} questions to {OUT}')


if __name__ == '__main__':
    main()
