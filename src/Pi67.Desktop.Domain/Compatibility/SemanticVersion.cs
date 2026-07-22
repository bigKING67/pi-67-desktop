using System.Buffers;
using System.Globalization;

namespace Pi67.Desktop.Domain.Compatibility;

public readonly record struct SemanticVersion(
    int Major,
    int Minor,
    int Patch,
    string? PreRelease = null) : IComparable<SemanticVersion>
{
    private static readonly SearchValues<char> IdentifierCharacters = SearchValues.Create(
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-");
    private static readonly SearchValues<char> NumericCharacters = SearchValues.Create("0123456789");

    public static bool operator <(SemanticVersion left, SemanticVersion right) =>
        left.CompareTo(right) < 0;

    public static bool operator <=(SemanticVersion left, SemanticVersion right) =>
        left.CompareTo(right) <= 0;

    public static bool operator >(SemanticVersion left, SemanticVersion right) =>
        left.CompareTo(right) > 0;

    public static bool operator >=(SemanticVersion left, SemanticVersion right) =>
        left.CompareTo(right) >= 0;

    public static bool TryParse(string? value, out SemanticVersion version)
    {
        version = default;
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        ReadOnlySpan<char> input = value.Trim().AsSpan();
        if (input.Length > 0 && (input[0] is 'v' or 'V'))
        {
            input = input[1..];
        }

        int buildSeparator = input.IndexOf('+');
        if (buildSeparator >= 0)
        {
            if (!IsValidIdentifierList(input[(buildSeparator + 1)..], numericLeadingZerosAllowed: true))
            {
                return false;
            }

            input = input[..buildSeparator];
        }

        string? preRelease = null;
        int preReleaseSeparator = input.IndexOf('-');
        if (preReleaseSeparator >= 0)
        {
            preRelease = input[(preReleaseSeparator + 1)..].ToString();
            input = input[..preReleaseSeparator];
            if (!IsValidIdentifierList(preRelease.AsSpan(), numericLeadingZerosAllowed: false))
            {
                return false;
            }
        }

        Span<Range> ranges = stackalloc Range[4];
        int count = input.Split(ranges, '.', StringSplitOptions.None);
        if (count != 3)
        {
            return false;
        }

        if (!TryParseComponent(input[ranges[0]], out int major)
            || !TryParseComponent(input[ranges[1]], out int minor))
        {
            return false;
        }

        if (!TryParseComponent(input[ranges[2]], out int patch))
        {
            return false;
        }

        version = new SemanticVersion(major, minor, patch, preRelease);
        return true;
    }

    public static SemanticVersion Parse(string value) =>
        TryParse(value, out SemanticVersion version)
            ? version
            : throw new FormatException($"Invalid semantic version: {value}");

    public int CompareTo(SemanticVersion other)
    {
        int core = Major.CompareTo(other.Major);
        if (core == 0)
        {
            core = Minor.CompareTo(other.Minor);
        }

        if (core == 0)
        {
            core = Patch.CompareTo(other.Patch);
        }

        if (core != 0)
        {
            return core;
        }

        if (PreRelease is null)
        {
            return other.PreRelease is null ? 0 : 1;
        }

        return other.PreRelease is null ? -1 : ComparePreRelease(PreRelease, other.PreRelease);
    }

    public override string ToString() =>
        PreRelease is null
            ? $"{Major}.{Minor}.{Patch}"
            : $"{Major}.{Minor}.{Patch}-{PreRelease}";

    private static bool TryParseComponent(ReadOnlySpan<char> value, out int component)
    {
        component = 0;
        if (value.Length == 0 || (value.Length > 1 && value[0] == '0'))
        {
            return false;
        }

        return int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out component)
            && component >= 0;
    }

    private static bool IsValidIdentifierList(
        ReadOnlySpan<char> value,
        bool numericLeadingZerosAllowed)
    {
        if (value.IsEmpty)
        {
            return false;
        }

        foreach (Range range in value.Split('.'))
        {
            ReadOnlySpan<char> identifier = value[range];
            if (identifier.IsEmpty
                || identifier.ContainsAnyExcept(IdentifierCharacters))
            {
                return false;
            }

            bool numeric = !identifier.ContainsAnyExcept(NumericCharacters);
            if (!numericLeadingZerosAllowed && numeric && identifier.Length > 1 && identifier[0] == '0')
            {
                return false;
            }
        }

        return true;
    }

    private static int ComparePreRelease(string left, string right)
    {
        string[] leftIdentifiers = left.Split('.');
        string[] rightIdentifiers = right.Split('.');
        int sharedLength = Math.Min(leftIdentifiers.Length, rightIdentifiers.Length);
        for (int index = 0; index < sharedLength; index++)
        {
            string leftIdentifier = leftIdentifiers[index];
            string rightIdentifier = rightIdentifiers[index];
            bool leftNumeric = IsNumeric(leftIdentifier);
            bool rightNumeric = IsNumeric(rightIdentifier);
            int comparison;
            if (leftNumeric && rightNumeric)
            {
                comparison = leftIdentifier.Length.CompareTo(rightIdentifier.Length);
                if (comparison == 0)
                {
                    comparison = StringComparer.Ordinal.Compare(leftIdentifier, rightIdentifier);
                }
            }
            else if (leftNumeric != rightNumeric)
            {
                comparison = leftNumeric ? -1 : 1;
            }
            else
            {
                comparison = StringComparer.Ordinal.Compare(leftIdentifier, rightIdentifier);
            }

            if (comparison != 0)
            {
                return comparison;
            }
        }

        return leftIdentifiers.Length.CompareTo(rightIdentifiers.Length);
    }

    private static bool IsNumeric(string value) =>
        !value.AsSpan().ContainsAnyExcept(NumericCharacters);
}
